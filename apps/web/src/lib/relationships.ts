import type { RelationshipId, Schema, TableId } from '@forge/core'

export interface RelationshipSummary {
  id: RelationshipId
  label: string
}

const display = (name: string) => (name.trim() === '' ? '(unnamed)' : name)

/** The relationships that start or end at a table, as `orders.user_id → users.id`. */
export function relationshipsOf(
  schema: Schema,
  tableId: TableId
): RelationshipSummary[] {
  const summaries: RelationshipSummary[] = []
  for (const relationship of schema.relationships) {
    const { from, to } = relationship
    if (from.tableId !== tableId && to.tableId !== tableId) continue

    const fromTable = schema.tables.find((table) => table.id === from.tableId)
    const toTable = schema.tables.find((table) => table.id === to.tableId)
    const fromColumn = fromTable?.columns.find(
      (column) => column.id === from.columnId
    )
    const toColumn = toTable?.columns.find(
      (column) => column.id === to.columnId
    )
    if (!fromTable || !toTable || !fromColumn || !toColumn) continue

    summaries.push({
      id: relationship.id,
      label: `${display(fromTable.name)}.${display(fromColumn.name)} → ${display(toTable.name)}.${display(toColumn.name)}`,
    })
  }
  return summaries
}
