import type { DialectId } from '../dialects/dialect.ts'

export type TableId = string
export type ColumnId = string
export type RelationshipId = string
export type TypeId = string
export type IndexId = string

export const SIMPLE_COLUMN_KINDS = [
  'integer',
  'bigint',
  'smallint',
  'number',
  'text',
  'boolean',
  'uuid',
  'timestamp',
  'timestamp_no_tz',
  'time',
  'date',
  'interval',
  'json',
  'real',
  'double',
  'bytea',
] as const

export type SimpleColumnKind = (typeof SIMPLE_COLUMN_KINDS)[number]

// PostgreSQL limits: varchar(n) up to 10485760, numeric precision up to 1000.
// They live here so the parser and every UI that edits a type share one value.
export const MAX_VARCHAR_LENGTH = 10_485_760
export const MAX_NUMERIC_PRECISION = 1000

export type ColumnType =
  | { kind: SimpleColumnKind }
  | { kind: 'varchar'; length: number }
  | { kind: 'char'; length: number }
  | { kind: 'numeric'; precision: number; scale: number }
  | { kind: 'array'; of: ColumnType }
  | { kind: 'user'; typeId: TypeId }
  /** A type the model has no logical kind for, kept as its database writes it. */
  | { kind: 'native'; dialect: DialectId; text: string }

/** The kinds a database can generate a value for: identity or a default (a timestamp defaults to now()). */
export const GENERATED_COLUMN_KINDS = [
  'integer',
  'bigint',
  'number',
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
  /** A raw SQL expression, written as is. Empty means none; it excludes `generated`. */
  default?: string
  /** Free text, emitted as COMMENT ON. Empty means none. */
  comment?: string
}

export const INDEX_METHODS = ['btree', 'hash', 'gin', 'gist'] as const
export type IndexMethod = (typeof INDEX_METHODS)[number]

export interface Index {
  id: IndexId
  name: string
  /** In the order the index sorts them. */
  columns: ColumnId[]
  unique: boolean
  method: IndexMethod
}

export interface Table {
  id: TableId
  name: string
  columns: Column[]
  primaryKey: ColumnId[]
  comment?: string
  /** Absent means none, which keeps projects saved before indexes valid. */
  indexes?: Index[]
}

export interface EnumType {
  kind: 'enum'
  id: TypeId
  name: string
  values: string[]
}

/** A domain's CHECK is not modelled. */
export interface DomainType {
  kind: 'domain'
  id: TypeId
  name: string
  base: ColumnType
  notNull?: boolean
  default?: string
}

export type UserType = EnumType | DomainType

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
  /** Absent means none. */
  types?: UserType[]
}
