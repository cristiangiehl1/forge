import type { ColumnType } from '../schema/types.ts'

export interface Dialect {
  id: string
  /** Longest identifier the database accepts, in UTF-8 bytes. */
  maxIdentifierBytes: number
  typeName(type: ColumnType, userTypeName?: (typeId: string) => string): string
  /** The clause that makes the database generate the column's value, if it can. */
  generatedClause(type: ColumnType): string | null
  /** Whether a generated column of this type is implicitly NOT NULL in the database. */
  generatedImpliesNotNull(type: ColumnType): boolean
  quoteIdentifier(name: string): string
  /** A string literal, quotes doubled. */
  quoteLiteral(text: string): string
}
