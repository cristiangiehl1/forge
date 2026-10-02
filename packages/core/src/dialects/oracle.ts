import type {
  Column,
  ColumnType,
  Index,
  Schema,
  Table,
} from '../schema/types.ts'
import type { Issue } from '../schema/validate.ts'
import { byteLength, uniqueName } from '../sql/generate/constraint-names.ts'
import type {
  Dialect,
  DialectOptions,
  IndexContext,
  TableContext,
  TableParts,
} from './dialect.ts'

/** The words Oracle does not let a name be unless it is quoted. */
const RESERVED = new Set(
  (
    'ACCESS ADD ALL ALTER AND ANY AS ASC AUDIT BETWEEN BY CHAR CHECK CLUSTER COLUMN ' +
    'COLUMN_VALUE COMMENT COMPRESS CONNECT CREATE CURRENT DATE DECIMAL DEFAULT DELETE ' +
    'DESC DISTINCT DROP ELSE EXCLUSIVE EXISTS FILE FLOAT FOR FROM GRANT GROUP HAVING ' +
    'IDENTIFIED IMMEDIATE IN INCREMENT INDEX INITIAL INSERT INTEGER INTERSECT INTO IS ' +
    'LEVEL LIKE LOCK LONG MAXEXTENTS MINUS MLSLABEL MODE MODIFY NESTED_TABLE_ID NOAUDIT ' +
    'NOCOMPRESS NOT NOWAIT NULL NUMBER OF OFFLINE ON ONLINE OPTION OR ORDER PCTFREE ' +
    'PRIOR PUBLIC RAW RENAME RESOURCE REVOKE ROW ROWID ROWNUM ROWS SELECT SESSION SET ' +
    'SHARE SIZE SMALLINT START SUCCESSFUL SYNONYM SYSDATE TABLE THEN TO TRIGGER UID ' +
    'UNION UNIQUE UPDATE USER VALIDATE VALUES VARCHAR VARCHAR2 VIEW WHENEVER WHERE WITH'
  ).split(' ')
)

const PLAIN = /^[A-Za-z][A-Za-z0-9_$#]*$/
const isPlain = (name: string) =>
  PLAIN.test(name) && !RESERVED.has(name.toUpperCase())

/**
 * Oracle cannot hold a double quote in a name, quoted or not, so nothing is
 * escaped here: `check` refuses such a name before a script is written.
 */
function quoteIdentifier(name: string): string {
  return isPlain(name) ? name.toUpperCase() : `"${name}"`
}

const hasForbiddenChar = (name: string): boolean =>
  name.includes('"') || name.includes('\0')

/** What a name is once Oracle has folded it: two names with the same fold collide. */
const fold = (name: string): string =>
  isPlain(name) ? name.toUpperCase() : name

function quoteLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`
}

const present = (text: string | undefined): text is string =>
  text !== undefined && text.trim() !== ''

const MAX_NAME_BYTES = 128
const MAX_VARCHAR2 = 4000
const MAX_CHAR = 2000
const MAX_NUMBER_PRECISION = 38

const GUID_WITH_HYPHENS =
  "LOWER(REGEXP_REPLACE(RAWTOHEX(SYS_GUID()), '([A-F0-9]{8})([A-F0-9]{4})([A-F0-9]{4})([A-F0-9]{4})([A-F0-9]{12})', '\\1-\\2-\\3-\\4-\\5'))"

/** A column type as Oracle stores it, and what has to go with it. */
interface Resolved {
  sql: string
  /** Stored as a CLOB or a BLOB: it cannot be a key or be indexed. */
  lob: boolean
  /** The CHECK that goes with the type, written for the quoted column name. */
  check?: (column: string) => string
  note?: { code: string; message: (where: string) => string }
  /** A domain's default and NOT NULL, repeated on the column. */
  domain?: { default?: string; notNull?: boolean }
  /** What a default written for this column may need translated. */
  defaultKind?: 'boolean' | 'timestamp' | 'timestamp_no_tz'
}

const NOW =
  /^(now\(\)|current_timestamp|transaction_timestamp\(\)|statement_timestamp\(\)|clock_timestamp\(\))$/i
const PLAIN_LITERAL = /^(-?\d+(\.\d+)?|'(?:[^']|'')*'|null)$/i

/**
 * A default as Oracle spells it. What has one spelling is translated; a plain
 * literal is kept; anything else is copied as written, with a note.
 */
function translateDefault(
  text: string,
  kind: Resolved['defaultKind']
): { sql: string; note: boolean } {
  const trimmed = text.trim()
  if (kind === 'boolean' && /^true$/i.test(trimmed))
    return { sql: '1', note: false }
  if (kind === 'boolean' && /^false$/i.test(trimmed))
    return { sql: '0', note: false }
  if (kind === 'timestamp' && NOW.test(trimmed))
    return { sql: 'SYSTIMESTAMP', note: false }
  if (kind === 'timestamp_no_tz' && NOW.test(trimmed)) {
    return { sql: 'LOCALTIMESTAMP', note: false }
  }
  return { sql: text, note: !PLAIN_LITERAL.test(trimmed) }
}

function resolveType(
  schema: Schema,
  type: ColumnType,
  options: DialectOptions
): Resolved {
  switch (type.kind) {
    case 'integer':
      return { sql: 'NUMBER(10)', lob: false }
    case 'bigint':
      return { sql: 'NUMBER(19)', lob: false }
    case 'smallint':
      return { sql: 'NUMBER(5)', lob: false }
    case 'numeric':
      if (type.precision > MAX_NUMBER_PRECISION) {
        return {
          sql: `NUMBER(${MAX_NUMBER_PRECISION},${Math.max(0, MAX_NUMBER_PRECISION - (type.precision - type.scale))})`,
          lob: false,
          note: {
            code: 'numeric-precision',
            message: (where) =>
              `${where}: the precision ${type.precision} was lowered to ${MAX_NUMBER_PRECISION}, the most Oracle allows; the integer digits were kept and the scale gave way.`,
          },
        }
      }
      return { sql: `NUMBER(${type.precision},${type.scale})`, lob: false }
    case 'varchar':
      if (type.length > MAX_VARCHAR2) {
        return {
          sql: 'CLOB',
          lob: true,
          note: {
            code: 'text-too-long',
            message: (where) =>
              `${where}: varchar(${type.length}) is longer than the ${MAX_VARCHAR2} bytes of a VARCHAR2, so it became a CLOB.`,
          },
        }
      }
      return { sql: `VARCHAR2(${type.length})`, lob: false }
    case 'char':
      if (type.length > MAX_CHAR) {
        return {
          sql: 'CLOB',
          lob: true,
          note: {
            code: 'text-too-long',
            message: (where) =>
              `${where}: char(${type.length}) is longer than the ${MAX_CHAR} bytes of a CHAR, so it became a CLOB.`,
          },
        }
      }
      return { sql: `CHAR(${type.length})`, lob: false }
    case 'text':
      return { sql: 'CLOB', lob: true }
    case 'boolean':
      return {
        sql: 'NUMBER(1)',
        lob: false,
        check: (column) => `${column} IN (0,1)`,
        defaultKind: 'boolean',
      }
    case 'uuid':
      return {
        sql: options.uuid === 'varchar36' ? 'VARCHAR2(36)' : 'RAW(16)',
        lob: false,
      }
    case 'timestamp':
      return {
        sql: 'TIMESTAMP WITH TIME ZONE',
        lob: false,
        defaultKind: 'timestamp',
      }
    case 'timestamp_no_tz':
      return { sql: 'TIMESTAMP', lob: false, defaultKind: 'timestamp_no_tz' }
    case 'date':
      return { sql: 'DATE', lob: false }
    case 'time':
      return { sql: 'INTERVAL DAY(0) TO SECOND(0)', lob: false }
    case 'interval':
      return { sql: 'INTERVAL DAY TO SECOND', lob: false }
    case 'json':
      return { sql: 'CLOB', lob: true, check: (column) => `${column} IS JSON` }
    case 'real':
      return { sql: 'BINARY_FLOAT', lob: false }
    case 'double':
      return { sql: 'BINARY_DOUBLE', lob: false }
    case 'bytea':
      return { sql: 'BLOB', lob: true }
    case 'array':
      return {
        sql: 'CLOB',
        lob: true,
        check: (column) => `${column} IS JSON`,
        note: {
          code: 'array-as-json',
          message: (where) =>
            `${where}: Oracle has no array column, so it is stored as a JSON array in a CLOB.`,
        },
      }
    case 'user': {
      const found = schema.types?.find(
        (candidate) => candidate.id === type.typeId
      )
      if (!found) return { sql: 'CLOB', lob: true }
      if (found.kind === 'enum') {
        const longest = Math.max(1, ...found.values.map(byteLength))
        return {
          sql: `VARCHAR2(${Math.min(longest, MAX_VARCHAR2)})`,
          lob: false,
          check: (column) =>
            `${column} IN (${found.values.map(quoteLiteral).join(', ')})`,
        }
      }
      const base = resolveType(schema, found.base, options)
      return {
        ...base,
        domain: {
          ...(present(found.default) ? { default: found.default } : {}),
          ...(found.notNull ? { notNull: true } : {}),
        },
      }
    }
  }
}

export function oracle(options: DialectOptions = {}): Dialect {
  const generatedClause = (type: ColumnType): string | null => {
    switch (type.kind) {
      case 'integer':
      case 'bigint':
        return 'GENERATED BY DEFAULT ON NULL AS IDENTITY'
      case 'uuid':
        return options.uuid === 'varchar36'
          ? `DEFAULT ${GUID_WITH_HYPHENS}`
          : 'DEFAULT SYS_GUID()'
      case 'timestamp':
        return 'DEFAULT SYSTIMESTAMP'
      default:
        return null
    }
  }
  const generatedImpliesNotNull = (type: ColumnType): boolean =>
    type.kind === 'integer' || type.kind === 'bigint'

  const constraintName = (kind: 'pk' | 'fk' | 'ck', parts: string[]): string =>
    `${kind.toUpperCase()}_${parts.join('_')}`.toUpperCase()

  const isLob = (table: Table, columnId: string, schema: Schema): boolean => {
    const column = table.columns.find((candidate) => candidate.id === columnId)
    return column !== undefined && resolveType(schema, column.type, options).lob
  }

  function tableParts({
    schema,
    table,
    notes,
    usedNames,
  }: TableContext): TableParts {
    const columns: string[] = []
    const checks: string[] = []
    for (const column of table.columns) {
      const resolved = resolveType(schema, column.type, options)
      const where = `${table.name}.${column.name}`
      if (resolved.note) {
        notes.push({
          code: resolved.note.code,
          message: resolved.note.message(where),
          tableId: table.id,
          columnId: column.id,
        })
      }
      const written = present(column.default)
        ? column.default
        : resolved.domain?.default
      let fallback = ''
      if (!column.generated && present(written)) {
        const translated = translateDefault(written, resolved.defaultKind)
        fallback = ` DEFAULT ${translated.sql}`
        if (translated.note) {
          notes.push({
            code: 'raw-default',
            message: `${where}: the default ${written} is copied as written and may be specific to another database.`,
            tableId: table.id,
            columnId: column.id,
          })
        }
      }
      const generated = column.generated ? generatedClause(column.type) : null
      const inKey = table.primaryKey.includes(column.id)
      const identity =
        column.generated === true && generatedImpliesNotNull(column.type)
      const required =
        (!column.nullable || resolved.domain?.notNull === true) &&
        !inKey &&
        !identity
      columns.push(
        `  ${quoteIdentifier(column.name)} ${resolved.sql}${fallback}${generated ? ` ${generated}` : ''}${required ? ' NOT NULL' : ''}`
      )
      if (resolved.check) {
        const name = uniqueName(
          constraintName('ck', [table.name, column.name]),
          usedNames,
          MAX_NAME_BYTES
        )
        checks.push(
          `  CONSTRAINT ${quoteIdentifier(name)} CHECK (${resolved.check(quoteIdentifier(column.name))})`
        )
      }
    }
    const keys: string[] = []
    if (table.primaryKey.length > 0) {
      const name = uniqueName(
        constraintName('pk', [table.name]),
        usedNames,
        MAX_NAME_BYTES
      )
      const names = table.primaryKey.map((id) => {
        const key = table.columns.find(
          (candidate) => candidate.id === id
        ) as Column
        return quoteIdentifier(key.name)
      })
      keys.push(
        `  CONSTRAINT ${quoteIdentifier(name)} PRIMARY KEY (${names.join(', ')})`
      )
    }
    return { columns, keys, checks }
  }

  function createIndex({
    schema,
    table,
    index,
    notes,
  }: IndexContext): string | null {
    const lob = index.columns.find((id) => isLob(table, id, schema))
    if (lob !== undefined) {
      const column = table.columns.find(
        (candidate) => candidate.id === lob
      ) as Column
      notes.push({
        code: 'index-on-lob',
        message: `Index ${index.name} was not created: ${table.name}.${column.name} is stored as a CLOB or BLOB, which Oracle does not index.`,
        tableId: table.id,
        indexId: index.id,
      })
      return null
    }
    if (index.method !== 'btree') {
      notes.push({
        code: 'index-method',
        message: `Index ${index.name}: Oracle has no ${index.method} method, so it was created as an ordinary index.`,
        tableId: table.id,
        indexId: index.id,
      })
    }
    const columns = index.columns.map((id) => {
      const column = table.columns.find(
        (candidate) => candidate.id === id
      ) as Column
      return quoteIdentifier(column.name)
    })
    return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdentifier(index.name)} ON ${quoteIdentifier(table.name)} (${columns.join(', ')});`
  }

  function check(schema: Schema): Issue[] {
    const issues: Issue[] = []
    const tooLong = (name: string) => byteLength(name) > MAX_NAME_BYTES
    const tableNames = new Map<string, string>()
    const invalid = (what: string, name: string, ids: Partial<Issue>) => {
      if (!hasForbiddenChar(name)) return false
      issues.push({
        code: 'dialect-name-invalid',
        message: `${what} "${name}" contains a double quote, which Oracle does not accept in a name.`,
        ...ids,
      } as Issue)
      return true
    }
    for (const table of schema.tables) {
      if (invalid('Table', table.name, { tableId: table.id })) continue
      if (tooLong(table.name)) {
        issues.push({
          code: 'dialect-name-too-long',
          message: `Table "${table.name}" has a name longer than the ${MAX_NAME_BYTES} bytes Oracle allows.`,
          tableId: table.id,
        })
      }
      const folded = fold(table.name)
      const same = tableNames.get(folded)
      if (same !== undefined) {
        issues.push({
          code: 'dialect-name-collision',
          message: `Tables "${same}" and "${table.name}" are the same name in Oracle (${folded}).`,
          tableId: table.id,
        })
      } else {
        tableNames.set(folded, table.name)
      }
      const columnNames = new Map<string, string>()
      for (const column of table.columns) {
        if (
          invalid('Column', column.name, {
            tableId: table.id,
            columnId: column.id,
          })
        ) {
          continue
        }
        if (tooLong(column.name)) {
          issues.push({
            code: 'dialect-name-too-long',
            message: `Column "${table.name}.${column.name}" has a name longer than the ${MAX_NAME_BYTES} bytes Oracle allows.`,
            tableId: table.id,
            columnId: column.id,
          })
        }
        const foldedColumn = fold(column.name)
        const sameColumn = columnNames.get(foldedColumn)
        if (sameColumn !== undefined) {
          issues.push({
            code: 'dialect-name-collision',
            message: `Columns "${sameColumn}" and "${column.name}" of "${table.name}" are the same name in Oracle (${foldedColumn}).`,
            tableId: table.id,
            columnId: column.id,
          })
        } else {
          columnNames.set(foldedColumn, column.name)
        }
      }
    }
    // Tables, indexes and the indexes of primary keys share one namespace.
    const taken = new Map<string, string>()
    for (const table of schema.tables)
      taken.set(fold(table.name), `the table "${table.name}"`)
    for (const table of schema.tables) {
      if (table.primaryKey.length > 0) {
        const key = fold(constraintName('pk', [table.name]))
        if (!taken.has(key))
          taken.set(key, `the primary key of "${table.name}"`)
      }
    }
    const indexNames = new Map<string, string>()
    for (const table of schema.tables) {
      for (const index of (table.indexes ?? []) as Index[]) {
        const ids = { tableId: table.id, indexId: index.id }
        if (invalid('Index', index.name, ids)) continue
        if (tooLong(index.name)) {
          issues.push({
            code: 'dialect-name-too-long',
            message: `Index "${index.name}" has a name longer than the ${MAX_NAME_BYTES} bytes Oracle allows.`,
            ...ids,
          })
        }
        const key = fold(index.name)
        const other = indexNames.get(key) ?? taken.get(key)
        if (other !== undefined) {
          issues.push({
            code: 'dialect-name-collision',
            message: `Index "${index.name}" has the same name in Oracle (${key}) as ${indexNames.has(key) ? `the index "${other}"` : other}.`,
            ...ids,
          })
        } else {
          indexNames.set(key, index.name)
        }
      }
    }

    const lobKey = (tableId: string, columnId: string, what: string) => {
      const table = schema.tables.find((candidate) => candidate.id === tableId)
      const column = table?.columns.find(
        (candidate) => candidate.id === columnId
      )
      if (!table || !column || !isLob(table, columnId, schema)) return
      issues.push({
        code: 'dialect-lob-key',
        message: `${what} "${table.name}.${column.name}" cannot be a key in Oracle: the column is stored as a CLOB or BLOB.`,
        tableId,
        columnId,
      })
    }
    for (const table of schema.tables) {
      for (const columnId of table.primaryKey)
        lobKey(table.id, columnId, 'Primary key')
      for (const index of (table.indexes ?? []) as Index[]) {
        if (!index.unique) continue
        for (const columnId of index.columns)
          lobKey(table.id, columnId, 'Unique index')
      }
    }
    for (const relationship of schema.relationships) {
      lobKey(
        relationship.from.tableId,
        relationship.from.columnId,
        'Foreign key'
      )
      lobKey(
        relationship.to.tableId,
        relationship.to.columnId,
        'Referenced column'
      )
    }
    return issues
  }

  return {
    id: 'oracle',
    maxIdentifierBytes: MAX_NAME_BYTES,
    supportsUserTypes: false,
    typeName: (type) =>
      resolveType({ version: 1, tables: [], relationships: [] }, type, options)
        .sql,
    generatedClause,
    generatedImpliesNotNull,
    quoteIdentifier,
    quoteLiteral,
    constraintName,
    check,
    tableParts,
    createIndex,
  }
}
