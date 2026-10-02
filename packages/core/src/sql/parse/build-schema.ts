import {
  addColumn,
  addIndex,
  addRelationship,
  addTable,
  addType,
  createSchema,
  setPrimaryKey,
  setTableComment,
  updateColumn,
} from '../../schema/operations.ts'
import type { ColumnType, Schema } from '../../schema/types.ts'
import { GENERATED_COLUMN_KINDS } from '../../schema/types.ts'
import { checkRelationship } from '../../schema/validate.ts'
import type {
  Origin,
  RawColumn,
  RawReference,
  RawScript,
  RawTable,
  RawType,
} from './raw.ts'

export type BuildWarn = (origin: Origin, message: string) => void

const NOW_DEFAULT =
  /^(now\(\)|current_timestamp(\(\d*\))?|transaction_timestamp\(\)|statement_timestamp\(\)|clock_timestamp\(\))(::[a-z ]+)?$/
const UUID_DEFAULT = /^(public\.)?(gen_random_uuid|uuid_generate_v4)\(\)$/
const SEQUENCE_DEFAULT = /^nextval\(/

interface BuiltTable {
  id: string
  raw: RawTable
  columnIds: Map<string, string>
}

interface ForeignKey {
  origin: Origin
  table: string
  columns: string[]
  reference: RawReference
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, at) => id === b[at])

export function buildSchema(
  raw: RawScript,
  newId: () => string,
  warn: BuildWarn
): Schema {
  let schema = createSchema()

  // ---- types: assigned first, so a column can use a type defined anywhere
  const typeIds = new Map<string, string>()
  for (const type of raw.types) {
    if (typeIds.has(type.name)) {
      warn(
        type.origin,
        `Type "${type.name}" is defined more than once; the first definition is kept.`
      )
    } else {
      typeIds.set(type.name, newId())
    }
  }
  const resolveType = (type: RawType, origin: Origin): ColumnType => {
    if (type.kind === 'named') {
      const typeId = typeIds.get(type.name)
      if (typeId !== undefined) return { kind: 'user', typeId }
      warn(origin, `Unknown type "${type.name}" is imported as text.`)
      return { kind: 'text' }
    }
    if (type.kind === 'array') {
      const element = resolveType(type.of, origin)
      return element.kind === 'array' ? element : { kind: 'array', of: element }
    }
    return type
  }
  const addedTypes = new Set<string>()
  for (const type of raw.types) {
    if (addedTypes.has(type.name)) continue
    addedTypes.add(type.name)
    const id = typeIds.get(type.name) as string
    schema = addType(
      schema,
      type.kind === 'enum'
        ? { kind: 'enum', id, name: type.name, values: type.values }
        : {
            kind: 'domain',
            id,
            name: type.name,
            base: resolveType(type.base, type.origin),
            ...(type.notNull ? { notNull: true } : {}),
            ...(type.default === undefined ? {} : { default: type.default }),
          }
    )
  }

  // ---- defaults and identities that pg_dump writes as ALTER COLUMN
  const defaultOverrides = new Map<string, string>()
  const identities = new Set<string>()
  for (const alter of raw.alters) {
    if ('setDefault' in alter) {
      defaultOverrides.set(
        `${alter.table}.${alter.setDefault.column}`,
        alter.setDefault.expression
      )
    } else if ('identity' in alter) {
      identities.add(`${alter.table}.${alter.identity}`)
    }
  }

  const interpret = (
    table: string,
    column: RawColumn,
    type: ColumnType,
    origin: Origin
  ): { generated: boolean; default?: string } => {
    const key = `${table}.${column.name}`
    const supported = (GENERATED_COLUMN_KINDS as readonly string[]).includes(
      type.kind
    )
    if (column.generated || identities.has(key)) {
      if (!supported) {
        warn(
          origin,
          `Column "${table}.${column.name}" is an identity or serial of type ${type.kind}, which Forge cannot generate; it is imported as a plain column.`
        )
        return { generated: false }
      }
      return { generated: true }
    }
    const text = (defaultOverrides.get(key) ?? column.default)?.trim()
    if (text === undefined || text === '') return { generated: false }
    const lower = text.toLowerCase()
    if (
      (type.kind === 'integer' || type.kind === 'bigint') &&
      SEQUENCE_DEFAULT.test(lower)
    ) {
      warn(
        origin,
        `The sequence default of "${table}.${column.name}" is imported as an identity column.`
      )
      return { generated: true }
    }
    if (type.kind === 'timestamp' && NOW_DEFAULT.test(lower))
      return { generated: true }
    if (type.kind === 'uuid' && UUID_DEFAULT.test(lower))
      return { generated: true }
    return { generated: false, default: text }
  }

  // ---- tables and columns
  const tables = new Map<string, BuiltTable>()
  for (const rawTable of raw.tables) {
    if (tables.has(rawTable.name)) {
      warn(
        rawTable.origin,
        `Table "${rawTable.name}" is defined more than once; the first definition is kept.`
      )
      continue
    }
    const tableId = newId()
    schema = addTable(schema, { id: tableId, name: rawTable.name })
    const alteredKey = raw.alters.find(
      (alter) => alter.table === rawTable.name && 'primaryKey' in alter
    )
    const keyNames =
      alteredKey && 'primaryKey' in alteredKey
        ? alteredKey.primaryKey
        : rawTable.primaryKey.length > 0
          ? rawTable.primaryKey
          : rawTable.columns.filter((c) => c.primaryKey).map((c) => c.name)

    const columnIds = new Map<string, string>()
    for (const column of rawTable.columns) {
      if (columnIds.has(column.name)) {
        warn(
          rawTable.origin,
          `Column "${rawTable.name}.${column.name}" is defined more than once; the first one is kept.`
        )
        continue
      }
      const type = resolveType(column.type, rawTable.origin)
      const { generated, default: fallback } = interpret(
        rawTable.name,
        column,
        type,
        rawTable.origin
      )
      const identityIsRequired =
        generated && (type.kind === 'integer' || type.kind === 'bigint')
      const id = newId()
      columnIds.set(column.name, id)
      schema = addColumn(schema, tableId, {
        id,
        name: column.name,
        type,
        nullable: !(
          column.notNull ||
          keyNames.includes(column.name) ||
          identityIsRequired
        ),
        ...(generated ? { generated: true } : {}),
        ...(fallback === undefined ? {} : { default: fallback }),
      })
    }
    const keyIds: string[] = []
    for (const name of keyNames) {
      const id = columnIds.get(name)
      if (id === undefined) {
        warn(
          rawTable.origin,
          `The primary key of "${rawTable.name}" uses the unknown column "${name}".`
        )
      } else {
        keyIds.push(id)
      }
    }
    schema = setPrimaryKey(schema, tableId, keyIds)
    tables.set(rawTable.name, { id: tableId, raw: rawTable, columnIds })
  }

  // ---- indexes
  const usedIndexNames = new Set<string>()
  const freeIndexName = (
    base: string,
    origin: Origin,
    written: boolean
  ): string => {
    let name = base
    for (let attempt = 2; usedIndexNames.has(name); attempt++)
      name = `${base}_${attempt}`
    if (name !== base && written) {
      warn(
        origin,
        `Index name "${base}" is already used; this one is named "${name}".`
      )
    }
    usedIndexNames.add(name)
    return name
  }
  const addIndexOn = (
    tableName: string,
    origin: Origin,
    columnNames: string[],
    unique: boolean,
    method: string,
    writtenName?: string
  ) => {
    const built = tables.get(tableName)
    if (!built) {
      warn(origin, `An index on the unknown table "${tableName}" was ignored.`)
      return
    }
    const columns: string[] = []
    for (const name of columnNames) {
      const id = built.columnIds.get(name)
      if (id === undefined) {
        warn(
          origin,
          `An index on "${tableName}" uses the unknown column "${name}" and was ignored.`
        )
        return
      }
      columns.push(id)
    }
    const present =
      schema.tables.find((table) => table.id === built.id)?.indexes ?? []
    if (
      unique &&
      present.some((index) => index.unique && sameIds(index.columns, columns))
    )
      return
    const base =
      writtenName ??
      `${unique ? 'uq' : 'idx'}_${tableName}_${columnNames.join('_')}`
    schema = addIndex(schema, built.id, {
      id: newId(),
      name: freeIndexName(base, origin, writtenName !== undefined),
      columns,
      unique,
      method: method as 'btree' | 'hash' | 'gin' | 'gist',
    })
  }
  for (const { raw: rawTable } of tables.values()) {
    for (const column of rawTable.columns) {
      if (column.unique)
        addIndexOn(rawTable.name, rawTable.origin, [column.name], true, 'btree')
    }
    for (const unique of rawTable.uniques) {
      addIndexOn(
        rawTable.name,
        rawTable.origin,
        unique.columns,
        true,
        'btree',
        unique.name
      )
    }
  }
  for (const alter of raw.alters) {
    if ('unique' in alter) {
      addIndexOn(
        alter.table,
        alter.origin,
        alter.unique.columns,
        true,
        'btree',
        alter.unique.name
      )
    }
  }
  for (const index of raw.indexes) {
    addIndexOn(
      index.table,
      index.origin,
      index.columns,
      index.unique,
      index.method,
      index.name
    )
  }

  // ---- foreign keys
  const keys: ForeignKey[] = []
  for (const { raw: rawTable } of tables.values()) {
    for (const column of rawTable.columns) {
      if (column.reference) {
        keys.push({
          origin: rawTable.origin,
          table: rawTable.name,
          columns: [column.name],
          reference: column.reference,
        })
      }
    }
    for (const key of rawTable.foreignKeys) {
      keys.push({ origin: rawTable.origin, table: rawTable.name, ...key })
    }
  }
  for (const alter of raw.alters) {
    if ('foreignKey' in alter) {
      keys.push({
        origin: alter.origin,
        table: alter.table,
        ...alter.foreignKey,
      })
    }
  }
  for (const key of keys) {
    const label = `${key.table}.${key.columns.join(', ')}`
    const from = tables.get(key.table)
    const to = tables.get(key.reference.table)
    if (!from) {
      warn(
        key.origin,
        `A foreign key on the unknown table "${key.table}" was ignored.`
      )
      continue
    }
    if (!to) {
      warn(
        key.origin,
        `The foreign key ${label} references the unknown table "${key.reference.table}" and was ignored.`
      )
      continue
    }
    if (key.columns.length !== 1 || key.reference.columns.length > 1) {
      warn(
        key.origin,
        `The foreign key ${label} is composite, which is not modelled; it was ignored.`
      )
      continue
    }
    const fromColumn = from.columnIds.get(key.columns[0] as string)
    if (fromColumn === undefined) {
      warn(
        key.origin,
        `The foreign key ${label} uses an unknown column and was ignored.`
      )
      continue
    }
    const target = schema.tables.find((table) => table.id === to.id)
    const toColumn =
      key.reference.columns.length === 0
        ? target?.primaryKey.length === 1
          ? target.primaryKey[0]
          : undefined
        : to.columnIds.get(key.reference.columns[0] as string)
    if (toColumn === undefined) {
      warn(
        key.origin,
        key.reference.columns.length === 0
          ? `The foreign key ${label} references "${key.reference.table}", which has no single primary key to point to; it was ignored.`
          : `The foreign key ${label} references the column "${key.reference.columns[0]}", which "${key.reference.table}" does not have; it was ignored.`
      )
      continue
    }
    const from_ = { tableId: from.id, columnId: fromColumn }
    const to_ = { tableId: to.id, columnId: toColumn }
    const issue = checkRelationship(schema, from_, to_)
    if (issue) {
      warn(key.origin, `The foreign key ${label} was ignored: ${issue.message}`)
      continue
    }
    schema = addRelationship(schema, { id: newId(), from: from_, to: to_ })
    if (key.reference.actions) {
      warn(
        key.origin,
        `ON DELETE / ON UPDATE actions of the foreign key ${label} are not modelled and were ignored.`
      )
    }
  }

  // ---- comments
  for (const comment of raw.comments) {
    const built = tables.get(comment.table)
    if (!built) {
      warn(
        comment.origin,
        `A comment on the unknown table "${comment.table}" was ignored.`
      )
      continue
    }
    if (comment.text.trim() === '') continue
    if (comment.column === undefined) {
      schema = setTableComment(schema, built.id, comment.text)
      continue
    }
    const columnId = built.columnIds.get(comment.column)
    if (columnId === undefined) {
      warn(
        comment.origin,
        `A comment on the unknown column "${comment.table}.${comment.column}" was ignored.`
      )
      continue
    }
    schema = updateColumn(schema, built.id, columnId, { comment: comment.text })
  }

  return schema
}
