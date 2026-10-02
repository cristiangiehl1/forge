/** The name a new index gets: `idx_<table>_<columns>`, or `uq_…` when unique. */
export const defaultIndexName = (
  table: string,
  columns: string[],
  unique: boolean
): string => `${unique ? 'uq' : 'idx'}_${table}_${columns.join('_')}`

/**
 * An index that still has its default name follows it when it becomes unique
 * or changes columns. The new name, or null when the name is the user's own or
 * nothing changes.
 */
export function renamedByDefault(
  current: { table: string; name: string; columns: string[]; unique: boolean },
  patch: { columns?: string[]; unique?: boolean }
): string | null {
  if (
    current.name !==
    defaultIndexName(current.table, current.columns, current.unique)
  ) {
    return null
  }
  const next = defaultIndexName(
    current.table,
    patch.columns ?? current.columns,
    patch.unique ?? current.unique
  )
  return next === current.name ? null : next
}
