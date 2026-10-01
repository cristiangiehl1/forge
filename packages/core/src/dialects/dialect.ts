import type { ColumnType } from '../schema/types.ts'

export interface Dialect {
  id: string
  /** Longest identifier the database accepts, in UTF-8 bytes. */
  maxIdentifierBytes: number
  typeName(type: ColumnType): string
  /** The clause that makes the database generate the column's value, if it can. */
  generatedClause(type: ColumnType): string | null
  quoteIdentifier(name: string): string
}
