import type { ColumnType, Schema } from '../schema/types.ts'
import type { Dialect } from './dialect.ts'

/** The SQL name of a column type; user types are written by their quoted name. */
export function typeSql(
  schema: Schema,
  dialect: Dialect,
  type: ColumnType
): string {
  return dialect.typeName(type, (typeId) => {
    const found = schema.types?.find((candidate) => candidate.id === typeId)
    return dialect.quoteIdentifier(found?.name ?? typeId)
  })
}
