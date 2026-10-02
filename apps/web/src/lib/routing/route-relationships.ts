import type { RelationshipId, Schema, TableId } from '@forge/core'

import type { Point, Side } from '../geometry.ts'
import { handlePoint, nodeRect } from '../geometry.ts'
import { routeEdge } from './route-edge.ts'

export interface RoutedRelationship {
  points: Point[]
  /** The side of the child (the table that holds the foreign key) the line leaves by. */
  sourceSide: Side
  /** The side of the parent (the referenced table) it arrives at. */
  targetSide: Side
}

const opposite = (side: Side): Side => (side === 'l' ? 'r' : 'l')

/** Beyond this many relationships only the sides that face each other are tried. */
const TRY_EVERY_SIDE_UP_TO = 30

/**
 * Routes every relationship round the tables. For each one the four ways of
 * choosing its two sides are tried, the facing pair first, and the cheapest
 * route wins, so the orientation of a line follows from where the tables are.
 * A table that references itself gets a loop on its right.
 */
export function routeRelationships(
  schema: Schema,
  positions: Record<TableId, Point>
): Map<RelationshipId, RoutedRelationship> {
  const tables = new Map(schema.tables.map((table) => [table.id, table]))
  const at = (id: TableId): Point => positions[id] ?? { x: 0, y: 0 }
  const obstacles = schema.tables.map((table) =>
    nodeRect(at(table.id), table.columns.length)
  )
  const tryEverySide = schema.relationships.length <= TRY_EVERY_SIDE_UP_TO

  const routes = new Map<RelationshipId, RoutedRelationship>()
  for (const relationship of schema.relationships) {
    const fromTable = tables.get(relationship.from.tableId)
    const toTable = tables.get(relationship.to.tableId)
    if (!fromTable || !toTable) continue
    const fromRow = fromTable.columns.findIndex(
      (c) => c.id === relationship.from.columnId
    )
    const toRow = toTable.columns.findIndex(
      (c) => c.id === relationship.to.columnId
    )
    if (fromRow < 0 || toRow < 0) continue

    const fromAt = at(fromTable.id)
    const toAt = at(toTable.id)

    if (fromTable.id === toTable.id) {
      const start = handlePoint(fromAt, fromRow, 'r')
      const end = handlePoint(toAt, toRow, 'r')
      const outside = start.x + 28
      routes.set(relationship.id, {
        points: [
          start,
          { x: outside, y: start.y },
          { x: outside, y: end.y },
          end,
        ],
        sourceSide: 'r',
        targetSide: 'r',
      })
      continue
    }

    const fromCentre = fromAt.x + 110
    const toCentre = toAt.x + 110
    const sourceFacing: Side = toCentre >= fromCentre ? 'r' : 'l'
    const targetFacing: Side = opposite(sourceFacing)
    const combinations: [Side, Side][] = tryEverySide
      ? [
          [sourceFacing, targetFacing],
          [sourceFacing, opposite(targetFacing)],
          [opposite(sourceFacing), targetFacing],
          [opposite(sourceFacing), opposite(targetFacing)],
        ]
      : [[sourceFacing, targetFacing]]

    let best: RoutedRelationship | undefined
    let bestCost = Number.POSITIVE_INFINITY
    for (const [sourceSide, targetSide] of combinations) {
      const route = routeEdge(
        obstacles,
        { point: handlePoint(fromAt, fromRow, sourceSide), side: sourceSide },
        { point: handlePoint(toAt, toRow, targetSide), side: targetSide }
      )
      if (route.cost < bestCost) {
        bestCost = route.cost
        best = { points: route.points, sourceSide, targetSide }
      }
    }
    if (best) routes.set(relationship.id, best)
  }
  return routes
}
