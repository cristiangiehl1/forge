import type { Schema, TableId } from '@forge/core'

import { resolvePositions } from '../canvas/to-flow.ts'
import type { Point } from '../geometry.ts'
import { nodeRect } from '../geometry.ts'
import { layoutTables } from '../layout/layout-tables.ts'
import type { ProjectView } from '../project-view.ts'

const GAP = 140
const snap = (value: number) => Math.round(value / 10) * 10

/**
 * Where the tables of an import go when it is added to a project: laid out by
 * their relationships, in a block to the right of everything already drawn,
 * level with the top of it. Existing tables are not moved.
 */
export function placeAdded(
  before: Schema,
  view: ProjectView,
  after: Schema,
  addedTableIds: TableId[]
): Record<TableId, Point> {
  const added = new Set(addedTableIds)
  const positions = resolvePositions(before, view)
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  for (const table of before.tables) {
    const position = positions[table.id] as Point
    const box = nodeRect(position, table.columns.length)
    right = Math.max(right, box.x + box.width)
    top = Math.min(top, box.y)
  }
  const origin: Point =
    before.tables.length === 0
      ? { x: 40, y: 40 }
      : { x: snap(right + GAP), y: snap(top) }

  const subset: Schema = {
    version: 1,
    tables: after.tables.filter((table) => added.has(table.id)),
    relationships: after.relationships.filter(
      (relationship) =>
        added.has(relationship.from.tableId) &&
        added.has(relationship.to.tableId)
    ),
  }
  return layoutTables(subset, { origin })
}
