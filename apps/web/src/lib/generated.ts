import type { Column, ColumnType } from '@forge/core'
import { GENERATED_COLUMN_KINDS, postgres } from '@forge/core'

import type { ColumnKind } from './column-types.ts'
import { defaultColumnType } from './column-types.ts'

/** Whether the database can generate values for a column of this type. */
export function supportsGenerated(type: ColumnType): boolean {
  return (GENERATED_COLUMN_KINDS as readonly string[]).includes(type.kind)
}

/**
 * The update for changing a column's type. A generated column keeps its mark
 * only if the new type can be generated; otherwise the mark is cleared, so a
 * type change never leaves the schema invalid.
 */
export function typeChangePatch(
  column: Column,
  kind: ColumnKind
): Partial<Omit<Column, 'id'>> {
  const type = defaultColumnType(kind)
  return column.generated && !supportsGenerated(type)
    ? { type, generated: false }
    : { type }
}

/** A generated identity column is NOT NULL in the database whatever the model says. */
export function impliesNotNull(column: Column): boolean {
  return (
    column.generated === true && postgres.generatedImpliesNotNull(column.type)
  )
}

/**
 * Whether the "Auto-generate" toggle is shown. It is also shown on a column that
 * is generated on a type that cannot be (a hand-edited project), so it can be cleared.
 */
export function showsGeneratedToggle(column: Column): boolean {
  return supportsGenerated(column.type) || column.generated === true
}
