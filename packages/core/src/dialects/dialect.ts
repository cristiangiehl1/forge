import type { ColumnType } from '../schema/types.ts'

export interface Dialect {
  id: string
  /** Longest identifier the database accepts, in UTF-8 bytes. */
  maxIdentifierBytes: number
  typeName(type: ColumnType): string
  quoteIdentifier(name: string): string
}
