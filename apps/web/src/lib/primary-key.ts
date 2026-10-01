import type { Table } from '@forge/core'

/** The primary key after (un)checking one column, in column order. */
export function nextPrimaryKey(
  table: Table,
  columnId: string,
  checked: boolean
): string[] {
  return table.columns
    .filter((column) =>
      column.id === columnId ? checked : table.primaryKey.includes(column.id)
    )
    .map((column) => column.id)
}
