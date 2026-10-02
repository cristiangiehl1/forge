import type { Dialect } from '../../dialects/dialect.ts'
import { userTypeIdsOf } from '../../schema/type-shape.ts'
import type {
  Column,
  ColumnType,
  Index,
  Relationship,
  Schema,
  Table,
  UserType,
} from '../../schema/types.ts'
import type { Issue } from '../../schema/validate.ts'
import { validate } from '../../schema/validate.ts'
import { uniqueName } from './constraint-names.ts'

/**
 * One statement of the script, and whose it is: a `create` belongs to the table it
 * creates, an `alter` to the table that holds the foreign key it adds. A UI uses
 * that to show which part of the script a table is.
 */
export type DdlStatement =
  | { kind: 'type'; key: string; typeId: string; sql: string }
  | { kind: 'create'; key: string; tableId: string; sql: string }
  | {
      kind: 'alter'
      key: string
      tableId: string
      relationshipId: string
      sql: string
    }
  | {
      kind: 'index'
      key: string
      tableId: string
      indexId: string
      sql: string
    }
  | { kind: 'comment'; key: string; tableId: string; sql: string }

export type GenerateResult =
  | { ok: true; sql: string; statements: DdlStatement[] }
  | { ok: false; issues: Issue[] }

const present = (text: string | undefined): text is string =>
  text !== undefined && text.trim() !== ''

/** The SQL name of a column type; user types are written by their quoted name. */
function typeSql(schema: Schema, dialect: Dialect, type: ColumnType): string {
  return dialect.typeName(type, (typeId) => {
    const found = schema.types?.find((candidate) => candidate.id === typeId)
    return dialect.quoteIdentifier(found?.name ?? typeId)
  })
}

/** Enums first, then each domain after the types it is based on. */
function orderTypes(types: UserType[]): UserType[] {
  const ordered: UserType[] = types.filter((type) => type.kind === 'enum')
  const pending = types.filter((type) => type.kind === 'domain')
  while (pending.length > 0) {
    const next = pending.findIndex(
      (domain) =>
        domain.kind === 'domain' &&
        userTypeIdsOf(domain.base).every((id) =>
          ordered.some((done) => done.id === id)
        )
    )
    ordered.push(...pending.splice(next === -1 ? 0 : next, 1))
  }
  return ordered
}

function createType(schema: Schema, type: UserType, dialect: Dialect): string {
  const name = dialect.quoteIdentifier(type.name)
  if (type.kind === 'enum') {
    const values = type.values.map((value) => dialect.quoteLiteral(value))
    return `CREATE TYPE ${name} AS ENUM (${values.join(', ')});`
  }
  const parts = [
    `CREATE DOMAIN ${name} AS ${typeSql(schema, dialect, type.base)}`,
  ]
  if (present(type.default)) parts.push(`DEFAULT ${type.default}`)
  if (type.notNull) parts.push('NOT NULL')
  return `${parts.join(' ')};`
}

function requireTable(schema: Schema, tableId: string): Table {
  const found = schema.tables.find((table) => table.id === tableId)
  if (!found) throw new Error(`Unknown table "${tableId}" in a valid schema.`)
  return found
}

function requireColumn(table: Table, columnId: string): Column {
  const found = table.columns.find((column) => column.id === columnId)
  if (!found) {
    throw new Error(`Unknown column "${columnId}" in table "${table.name}".`)
  }
  return found
}

interface ForeignKey {
  name: string
  /** `FOREIGN KEY (...) REFERENCES ...`, without a constraint name. */
  clause: string
  fromTable: string
}

/** Names a relationship's constraint and writes its `FOREIGN KEY` clause. */
function foreignKeyOf(
  schema: Schema,
  relationship: Relationship,
  dialect: Dialect,
  usedNames: Set<string>
): ForeignKey {
  const quote = (name: string) => dialect.quoteIdentifier(name)
  const fromTable = requireTable(schema, relationship.from.tableId)
  const fromColumn = requireColumn(fromTable, relationship.from.columnId)
  const toTable = requireTable(schema, relationship.to.tableId)
  const toColumn = requireColumn(toTable, relationship.to.columnId)
  return {
    name: uniqueName(
      `fk_${fromTable.name}_${fromColumn.name}`,
      usedNames,
      dialect.maxIdentifierBytes
    ),
    clause: `FOREIGN KEY (${quote(fromColumn.name)}) REFERENCES ${quote(toTable.name)} (${quote(toColumn.name)})`,
    fromTable: fromTable.name,
  }
}

function createIndex(table: Table, index: Index, dialect: Dialect): string {
  const quote = (name: string) => dialect.quoteIdentifier(name)
  const columns = index.columns.map((id) =>
    quote(requireColumn(table, id).name)
  )
  const using = index.method === 'btree' ? '' : ` USING ${index.method}`
  return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quote(index.name)} ON ${quote(table.name)}${using} (${columns.join(', ')});`
}

function createTable(
  schema: Schema,
  table: Table,
  inline: Relationship[],
  dialect: Dialect,
  usedNames: Set<string>
): string {
  const quote = (name: string) => dialect.quoteIdentifier(name)
  const lines = table.columns.map((column) => {
    // The script must say what the database will do: an identity column is
    // NOT NULL whether or not the model says so.
    const required =
      !column.nullable ||
      table.primaryKey.includes(column.id) ||
      (column.generated === true &&
        dialect.generatedImpliesNotNull(column.type))
    const generated = column.generated
      ? dialect.generatedClause(column.type)
      : null
    const fallback =
      present(column.default) && !column.generated
        ? ` DEFAULT ${column.default}`
        : ''
    return `  ${quote(column.name)} ${typeSql(schema, dialect, column.type)}${required ? ' NOT NULL' : ''}${fallback}${generated ? ` ${generated}` : ''}`
  })
  if (table.primaryKey.length > 0) {
    const names = table.primaryKey.map((id) =>
      quote(requireColumn(table, id).name)
    )
    lines.push(`  PRIMARY KEY (${names.join(', ')})`)
  }
  for (const relationship of inline) {
    const foreignKey = foreignKeyOf(schema, relationship, dialect, usedNames)
    lines.push(`  CONSTRAINT ${quote(foreignKey.name)} ${foreignKey.clause}`)
  }
  if (lines.length === 0) return `CREATE TABLE ${quote(table.name)} ();`
  return `CREATE TABLE ${quote(table.name)} (\n${lines.join(',\n')}\n);`
}

function addForeignKey(
  schema: Schema,
  relationship: Relationship,
  dialect: Dialect,
  usedNames: Set<string>
): string {
  const quote = (name: string) => dialect.quoteIdentifier(name)
  const foreignKey = foreignKeyOf(schema, relationship, dialect, usedNames)
  return [
    `ALTER TABLE ${quote(foreignKey.fromTable)}`,
    `  ADD CONSTRAINT ${quote(foreignKey.name)}`,
    `  ${foreignKey.clause};`,
  ].join('\n')
}

interface PlannedTable {
  table: Table
  /** The relationships declared inside this table's CREATE TABLE. */
  inline: Relationship[]
}

/**
 * A foreign key can only point at a table that already exists, so a table is
 * created right after the tables it references; otherwise the schema order is
 * kept. A reference to a table that is still being placed (a cycle) cannot be
 * declared inside the table: only that relationship is deferred to an
 * ALTER TABLE after every table exists. A table that references itself is fine.
 */
function planTables(schema: Schema): {
  planned: PlannedTable[]
  deferred: Relationship[]
} {
  const state = new Map<string, 'visiting' | 'done'>()
  const planned: PlannedTable[] = []
  const deferred: Relationship[] = []

  const visit = (table: Table) => {
    state.set(table.id, 'visiting')
    const inline: Relationship[] = []
    for (const relationship of schema.relationships) {
      if (relationship.from.tableId !== table.id) continue
      const targetId = relationship.to.tableId
      if (targetId === table.id) {
        inline.push(relationship)
        continue
      }
      const status = state.get(targetId)
      if (status === 'visiting') {
        deferred.push(relationship)
        continue
      }
      if (status === undefined) visit(requireTable(schema, targetId))
      inline.push(relationship)
    }
    state.set(table.id, 'done')
    planned.push({ table, inline })
  }

  for (const table of schema.tables) {
    if (!state.has(table.id)) visit(table)
  }
  return { planned, deferred }
}

export function generateDdl(schema: Schema, dialect: Dialect): GenerateResult {
  const issues = validate(schema)
  if (issues.length > 0) return { ok: false, issues }

  const { planned, deferred } = planTables(schema)
  const usedNames = new Set<string>()
  const statements: DdlStatement[] = orderTypes(schema.types ?? []).map(
    (type) => ({
      kind: 'type',
      key: `type:${type.id}`,
      typeId: type.id,
      sql: createType(schema, type, dialect),
    })
  )
  for (const { table, inline } of planned) {
    statements.push({
      kind: 'create',
      key: `create:${table.id}`,
      tableId: table.id,
      sql: createTable(schema, table, inline, dialect, usedNames),
    })
  }
  for (const relationship of deferred) {
    statements.push({
      kind: 'alter',
      key: `alter:${relationship.id}`,
      tableId: relationship.from.tableId,
      relationshipId: relationship.id,
      sql: addForeignKey(schema, relationship, dialect, usedNames),
    })
  }

  for (const table of schema.tables) {
    for (const index of table.indexes ?? []) {
      statements.push({
        kind: 'index',
        key: `index:${index.id}`,
        tableId: table.id,
        indexId: index.id,
        sql: createIndex(table, index, dialect),
      })
    }
  }
  const quote = (name: string) => dialect.quoteIdentifier(name)
  for (const table of schema.tables) {
    if (present(table.comment)) {
      statements.push({
        kind: 'comment',
        key: `comment:table:${table.id}`,
        tableId: table.id,
        sql: `COMMENT ON TABLE ${quote(table.name)} IS ${dialect.quoteLiteral(table.comment)};`,
      })
    }
    for (const column of table.columns) {
      if (!present(column.comment)) continue
      statements.push({
        kind: 'comment',
        key: `comment:column:${column.id}`,
        tableId: table.id,
        sql: `COMMENT ON COLUMN ${quote(table.name)}.${quote(column.name)} IS ${dialect.quoteLiteral(column.comment)};`,
      })
    }
  }

  return {
    ok: true,
    sql:
      statements.length === 0
        ? ''
        : `${statements.map((statement) => statement.sql).join('\n\n')}\n`,
    statements,
  }
}
