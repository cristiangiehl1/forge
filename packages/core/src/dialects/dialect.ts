import type {
  ColumnId,
  ColumnType,
  Index,
  IndexId,
  Schema,
  Table,
  TableId,
} from '../schema/types.ts'
import type { Issue } from '../schema/validate.ts'

export const DIALECT_IDS = ['postgres', 'oracle'] as const
export type DialectId = (typeof DIALECT_IDS)[number]

/** Choices a dialect leaves to the project. */
export interface DialectOptions {
  /** How Oracle stores a uuid. Default `raw16`. */
  uuid?: 'raw16' | 'varchar36'
}

/** Something the dialect adapted or could not translate; the script is still written. */
export interface DialectNote {
  code: string
  message: string
  tableId?: TableId
  columnId?: ColumnId
  indexId?: IndexId
}

/** The lines of a CREATE TABLE a dialect decides, each indented by two spaces. */
export interface TableParts {
  columns: string[]
  /** The primary key. */
  keys: string[]
  /** CHECK constraints, written after the foreign keys. */
  checks: string[]
}

export interface TableContext {
  schema: Schema
  table: Table
  notes: DialectNote[]
  /** Constraint names taken so far in the whole script. */
  usedNames: Set<string>
}

export interface IndexContext {
  schema: Schema
  table: Table
  index: Index
  notes: DialectNote[]
}

export interface Dialect {
  id: DialectId
  /** Longest identifier the database accepts, in UTF-8 bytes. */
  maxIdentifierBytes: number
  /** Whether CREATE TYPE and CREATE DOMAIN exist: when not, enums and domains are folded into the columns. */
  supportsUserTypes: boolean
  typeName(type: ColumnType, userTypeName?: (typeId: string) => string): string
  /** The clause that makes the database generate the column's value, if it can. */
  generatedClause(type: ColumnType): string | null
  /** Whether a generated column of this type is implicitly NOT NULL in the database. */
  generatedImpliesNotNull(type: ColumnType): boolean
  quoteIdentifier(name: string): string
  /** A string literal, quotes doubled. */
  quoteLiteral(text: string): string
  /** The name of a generated constraint, before it is made unique. */
  constraintName(kind: 'pk' | 'fk' | 'ck', parts: string[]): string
  /** What makes the schema impossible in this dialect. */
  check(schema: Schema): Issue[]
  tableParts(context: TableContext): TableParts
  /** The CREATE INDEX statement, or null when the dialect cannot create it (and says why in a note). */
  createIndex(context: IndexContext): string | null
}
