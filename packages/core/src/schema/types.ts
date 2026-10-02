export type TableId = string
export type ColumnId = string
export type RelationshipId = string

export const SIMPLE_COLUMN_KINDS = [
  'integer',
  'bigint',
  'text',
  'boolean',
  'uuid',
  'timestamp',
  'date',
  'json',
] as const

export type SimpleColumnKind = (typeof SIMPLE_COLUMN_KINDS)[number]

// PostgreSQL limits: varchar(n) up to 10485760, numeric precision up to 1000.
// They live here so the parser and every UI that edits a type share one value.
export const MAX_VARCHAR_LENGTH = 10_485_760
export const MAX_NUMERIC_PRECISION = 1000

export type ColumnType =
  | { kind: SimpleColumnKind }
  | { kind: 'varchar'; length: number }
  | { kind: 'numeric'; precision: number; scale: number }

/** The kinds a database can generate a value for: identity or a default (a timestamp defaults to now()). */
export const GENERATED_COLUMN_KINDS = [
  'integer',
  'bigint',
  'uuid',
  'timestamp',
] as const

export interface Column {
  id: ColumnId
  name: string
  type: ColumnType
  nullable: boolean
  /**
   * The database generates the value (identity for integers, a default for a
   * uuid). Absent means false, which keeps projects saved before it valid.
   */
  generated?: boolean
}

export interface Table {
  id: TableId
  name: string
  columns: Column[]
  primaryKey: ColumnId[]
}

export interface ColumnRef {
  tableId: TableId
  columnId: ColumnId
}

/** `from` references `to`; it becomes a FOREIGN KEY. */
export interface Relationship {
  id: RelationshipId
  from: ColumnRef
  to: ColumnRef
}

export interface Schema {
  version: 1
  tables: Table[]
  relationships: Relationship[]
}
