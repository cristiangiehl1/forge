import type {
  Column,
  ColumnType,
  Relationship,
  Schema,
  Table,
} from '../../schema/types.ts'

export function column(
  id: string,
  name: string,
  type: ColumnType = { kind: 'text' },
  nullable = true
): Column {
  return { id, name, type, nullable }
}

export function table(
  id: string,
  name: string,
  columns: Column[] = [],
  primaryKey: string[] = []
): Table {
  return { id, name, columns, primaryKey }
}

export function schemaOf(
  tables: Table[],
  relationships: Relationship[] = []
): Schema {
  return { version: 1, tables, relationships }
}

/** Freezes recursively so a mutating operation throws instead of passing. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
