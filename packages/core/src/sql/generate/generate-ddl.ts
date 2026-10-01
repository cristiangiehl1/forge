import type { Dialect } from '../../dialects/dialect.ts'
import type { Column, Relationship, Schema, Table } from '../../schema/types.ts'
import type { Issue } from '../../schema/validate.ts'
import { validate } from '../../schema/validate.ts'
import { uniqueName } from './constraint-names.ts'

export type GenerateResult =
  | { ok: true; sql: string }
  | { ok: false; issues: Issue[] }

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

function createTable(table: Table, dialect: Dialect): string {
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
    return `  ${quote(column.name)} ${dialect.typeName(column.type)}${required ? ' NOT NULL' : ''}${generated ? ` ${generated}` : ''}`
  })
  if (table.primaryKey.length > 0) {
    const names = table.primaryKey.map((id) =>
      quote(requireColumn(table, id).name)
    )
    lines.push(`  PRIMARY KEY (${names.join(', ')})`)
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
  const fromTable = requireTable(schema, relationship.from.tableId)
  const fromColumn = requireColumn(fromTable, relationship.from.columnId)
  const toTable = requireTable(schema, relationship.to.tableId)
  const toColumn = requireColumn(toTable, relationship.to.columnId)
  const name = uniqueName(
    `fk_${fromTable.name}_${fromColumn.name}`,
    usedNames,
    dialect.maxIdentifierBytes
  )
  return [
    `ALTER TABLE ${quote(fromTable.name)}`,
    `  ADD CONSTRAINT ${quote(name)}`,
    `  FOREIGN KEY (${quote(fromColumn.name)}) REFERENCES ${quote(toTable.name)} (${quote(toColumn.name)});`,
  ].join('\n')
}

export function generateDdl(schema: Schema, dialect: Dialect): GenerateResult {
  const issues = validate(schema)
  if (issues.length > 0) return { ok: false, issues }

  const statements = schema.tables.map((table) => createTable(table, dialect))
  const usedNames = new Set<string>()
  for (const relationship of schema.relationships) {
    statements.push(addForeignKey(schema, relationship, dialect, usedNames))
  }

  return {
    ok: true,
    sql: statements.length === 0 ? '' : `${statements.join('\n\n')}\n`,
  }
}
