import type {
  Column,
  ColumnId,
  Relationship,
  RelationshipId,
  Schema,
  Table,
  TableId,
} from './types.ts'

export function createSchema(): Schema {
  return { version: 1, tables: [], relationships: [] }
}

function findTable(schema: Schema, tableId: TableId): Table | undefined {
  return schema.tables.find((candidate) => candidate.id === tableId)
}

function replaceTable(
  schema: Schema,
  tableId: TableId,
  update: (table: Table) => Table
): Schema {
  return {
    ...schema,
    tables: schema.tables.map((candidate) =>
      candidate.id === tableId ? update(candidate) : candidate
    ),
  }
}

export function addTable(
  schema: Schema,
  table: { id: TableId; name: string }
): Schema {
  const created: Table = {
    id: table.id,
    name: table.name,
    columns: [],
    primaryKey: [],
  }
  return { ...schema, tables: [...schema.tables, created] }
}

export function renameTable(
  schema: Schema,
  tableId: TableId,
  name: string
): Schema {
  if (!findTable(schema, tableId)) return schema
  return replaceTable(schema, tableId, (table) => ({ ...table, name }))
}

export function removeTable(schema: Schema, tableId: TableId): Schema {
  if (!findTable(schema, tableId)) return schema
  return {
    ...schema,
    tables: schema.tables.filter((table) => table.id !== tableId),
    relationships: schema.relationships.filter(
      (relationship) =>
        relationship.from.tableId !== tableId &&
        relationship.to.tableId !== tableId
    ),
  }
}

export function addColumn(
  schema: Schema,
  tableId: TableId,
  column: Column
): Schema {
  if (!findTable(schema, tableId)) return schema
  return replaceTable(schema, tableId, (table) => ({
    ...table,
    columns: [...table.columns, column],
  }))
}

export function updateColumn(
  schema: Schema,
  tableId: TableId,
  columnId: ColumnId,
  patch: Partial<Omit<Column, 'id'>>
): Schema {
  const table = findTable(schema, tableId)
  if (!table?.columns.some((column) => column.id === columnId)) return schema
  return replaceTable(schema, tableId, (current) => ({
    ...current,
    columns: current.columns.map((column) =>
      column.id === columnId ? { ...column, ...patch, id: column.id } : column
    ),
  }))
}

export function removeColumn(
  schema: Schema,
  tableId: TableId,
  columnId: ColumnId
): Schema {
  const table = findTable(schema, tableId)
  if (!table?.columns.some((column) => column.id === columnId)) return schema
  const withoutColumn = replaceTable(schema, tableId, (current) => ({
    ...current,
    columns: current.columns.filter((column) => column.id !== columnId),
    primaryKey: current.primaryKey.filter((id) => id !== columnId),
  }))
  return {
    ...withoutColumn,
    relationships: withoutColumn.relationships.filter(
      (relationship) =>
        !(
          relationship.from.tableId === tableId &&
          relationship.from.columnId === columnId
        ) &&
        !(
          relationship.to.tableId === tableId &&
          relationship.to.columnId === columnId
        )
    ),
  }
}

export function setPrimaryKey(
  schema: Schema,
  tableId: TableId,
  columnIds: ColumnId[]
): Schema {
  const table = findTable(schema, tableId)
  if (!table) return schema
  const primaryKey = [...new Set(columnIds)].filter((id) =>
    table.columns.some((column) => column.id === id)
  )
  return replaceTable(schema, tableId, (current) => ({
    ...current,
    primaryKey,
  }))
}

export function addRelationship(
  schema: Schema,
  relationship: Relationship
): Schema {
  return { ...schema, relationships: [...schema.relationships, relationship] }
}

export function removeRelationship(
  schema: Schema,
  relationshipId: RelationshipId
): Schema {
  if (!schema.relationships.some((r) => r.id === relationshipId)) return schema
  return {
    ...schema,
    relationships: schema.relationships.filter((r) => r.id !== relationshipId),
  }
}
