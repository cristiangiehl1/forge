import { userTypeIdsOf } from './type-shape.ts'
import type {
  Column,
  ColumnId,
  Index,
  IndexId,
  Relationship,
  RelationshipId,
  Schema,
  Table,
  TableId,
  TypeId,
  UserType,
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
  const withoutColumn = replaceTable(schema, tableId, (current) => {
    const indexes = current.indexes
      ?.map((index) => ({
        ...index,
        columns: index.columns.filter((id) => id !== columnId),
      }))
      .filter((index) => index.columns.length > 0)
    return {
      ...current,
      columns: current.columns.filter((column) => column.id !== columnId),
      primaryKey: current.primaryKey.filter((id) => id !== columnId),
      ...(indexes ? { indexes } : {}),
    }
  })
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

export function setTableComment(
  schema: Schema,
  tableId: TableId,
  comment: string
): Schema {
  if (!findTable(schema, tableId)) return schema
  return replaceTable(schema, tableId, (table) => {
    const { comment: _previous, ...rest } = table
    return comment === '' ? rest : { ...rest, comment }
  })
}

export function addIndex(
  schema: Schema,
  tableId: TableId,
  index: Index
): Schema {
  if (!findTable(schema, tableId)) return schema
  return replaceTable(schema, tableId, (table) => ({
    ...table,
    indexes: [...(table.indexes ?? []), index],
  }))
}

export function updateIndex(
  schema: Schema,
  tableId: TableId,
  indexId: IndexId,
  patch: Partial<Omit<Index, 'id'>>
): Schema {
  const table = findTable(schema, tableId)
  if (!table?.indexes?.some((index) => index.id === indexId)) return schema
  return replaceTable(schema, tableId, (current) => ({
    ...current,
    indexes: (current.indexes ?? []).map((index) =>
      index.id === indexId ? { ...index, ...patch, id: index.id } : index
    ),
  }))
}

export function removeIndex(
  schema: Schema,
  tableId: TableId,
  indexId: IndexId
): Schema {
  const table = findTable(schema, tableId)
  if (!table?.indexes?.some((index) => index.id === indexId)) return schema
  return replaceTable(schema, tableId, (current) => ({
    ...current,
    indexes: (current.indexes ?? []).filter((index) => index.id !== indexId),
  }))
}

export function addType(schema: Schema, type: UserType): Schema {
  return { ...schema, types: [...(schema.types ?? []), type] }
}

/** Replaces the type that has the same id. */
export function updateType(schema: Schema, type: UserType): Schema {
  if (!schema.types?.some((candidate) => candidate.id === type.id)) {
    return schema
  }
  return {
    ...schema,
    types: schema.types.map((candidate) =>
      candidate.id === type.id ? type : candidate
    ),
  }
}

export type TypeUsage =
  | { kind: 'column'; tableId: TableId; columnId: ColumnId }
  | { kind: 'domain'; typeId: TypeId }

/** Everything that mentions a user type, so a UI can say why it cannot go. */
export function typeUsages(schema: Schema, typeId: TypeId): TypeUsage[] {
  const usages: TypeUsage[] = []
  for (const table of schema.tables) {
    for (const column of table.columns) {
      if (userTypeIdsOf(column.type).includes(typeId)) {
        usages.push({ kind: 'column', tableId: table.id, columnId: column.id })
      }
    }
  }
  for (const type of schema.types ?? []) {
    if (
      type.kind === 'domain' &&
      type.id !== typeId &&
      userTypeIdsOf(type.base).includes(typeId)
    ) {
      usages.push({ kind: 'domain', typeId: type.id })
    }
  }
  return usages
}

/** Whether a type is, directly or through domains, based on `targetId`. */
export function typeDependsOn(
  schema: Schema,
  typeId: TypeId,
  targetId: TypeId
): boolean {
  const visited = new Set<TypeId>()
  const queue = [typeId]
  while (queue.length > 0) {
    const currentId = queue.pop()
    const current = schema.types?.find((type) => type.id === currentId)
    if (current?.kind !== 'domain') continue
    for (const id of userTypeIdsOf(current.base)) {
      if (id === targetId) return true
      if (visited.has(id)) continue
      visited.add(id)
      queue.push(id)
    }
  }
  return false
}

/** A type that is still used stays: the schema comes back unchanged. */
export function removeType(schema: Schema, typeId: TypeId): Schema {
  if (!schema.types?.some((type) => type.id === typeId)) return schema
  if (typeUsages(schema, typeId).length > 0) return schema
  return {
    ...schema,
    types: schema.types.filter((type) => type.id !== typeId),
  }
}
