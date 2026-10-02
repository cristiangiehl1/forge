import type { ColumnType, TypeId } from './types.ts'

/**
 * Whether two column types are the same for a foreign key: the same kind, the
 * same element for arrays, the same type for user types. Length, precision and
 * scale are ignored, as PostgreSQL lets a foreign key differ in those.
 */
export function sameTypeShape(a: ColumnType, b: ColumnType): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'array' && b.kind === 'array') {
    return sameTypeShape(a.of, b.of)
  }
  if (a.kind === 'user' && b.kind === 'user') return a.typeId === b.typeId
  return true
}

/** The ids of the user types a column type mentions, arrays included. */
export function userTypeIdsOf(type: ColumnType): TypeId[] {
  if (type.kind === 'array') return userTypeIdsOf(type.of)
  return type.kind === 'user' ? [type.typeId] : []
}
