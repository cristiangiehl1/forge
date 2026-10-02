import type { ColumnRef, RelationshipId, Schema, TableId } from '@forge/core'
import type { Edge, Node } from '@xyflow/react'

import type { Point, Side } from '../geometry.ts'
import type { ProjectView } from '../project-view.ts'
import { nextNodePosition } from '../project-view.ts'
import type { RoutedRelationship } from '../routing/route-relationships.ts'

/** A table node references a table by id and holds no schema data. */
export type TableNodeData = { tableId: TableId }

export type TableFlowNode = Node<TableNodeData, 'table'>

/** What a relationship line needs to be drawn: the route worked out for it. */
export type RelationshipEdgeData = { points: Point[] }

export type RelationshipFlowEdge = Edge<RelationshipEdgeData, 'relationship'>

/**
 * Every column row has a connection point on each side of its table, so a line
 * can leave or arrive by whichever side its route chose. The id says which.
 */
export const handleId = (columnId: string, side: Side): string =>
  `${columnId}:${side}`

export const columnOfHandle = (id: string): string => id.replace(/:[lr]$/, '')

/** Where each table is: its saved position, or its place in the grid. */
export function resolvePositions(
  schema: Schema,
  view: ProjectView
): Record<TableId, Point> {
  return Object.fromEntries(
    schema.tables.map((table, index) => [
      table.id,
      view.nodes[table.id] ?? nextNodePosition(index),
    ])
  )
}

export function toFlowNodes(
  schema: Schema,
  view: ProjectView,
  selection: TableId | null
): TableFlowNode[] {
  const positions = resolvePositions(schema, view)
  return schema.tables.map((table) => ({
    id: table.id,
    type: 'table',
    position: positions[table.id] as Point,
    data: { tableId: table.id },
    selected: table.id === selection,
  }))
}

/**
 * One edge per relationship that has a route. The handles are the sides the route
 * chose, and the route itself travels in `data` for the edge to draw. The edges
 * of the hovered table are marked as related.
 */
export function toFlowEdges(
  schema: Schema,
  routes: Map<RelationshipId, RoutedRelationship>,
  selectedRelationship: RelationshipId | null,
  hoveredTable: TableId | null
): RelationshipFlowEdge[] {
  return schema.relationships.flatMap((relationship) => {
    const route = routes.get(relationship.id)
    if (!route) return []
    const related =
      hoveredTable !== null &&
      (relationship.from.tableId === hoveredTable ||
        relationship.to.tableId === hoveredTable)
    const edge: RelationshipFlowEdge = {
      id: relationship.id,
      type: 'relationship',
      source: relationship.from.tableId,
      sourceHandle: handleId(relationship.from.columnId, route.sourceSide),
      target: relationship.to.tableId,
      targetHandle: handleId(relationship.to.columnId, route.targetSide),
      selected: relationship.id === selectedRelationship,
      data: { points: route.points },
      ...(related ? { className: 'related' } : {}),
    }
    return [edge]
  })
}

export interface ConnectionLike {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export function connectionToRefs(
  connection: ConnectionLike
): { from: ColumnRef; to: ColumnRef } | null {
  if (!connection.sourceHandle || !connection.targetHandle) return null
  return {
    from: {
      tableId: connection.source,
      columnId: columnOfHandle(connection.sourceHandle),
    },
    to: {
      tableId: connection.target,
      columnId: columnOfHandle(connection.targetHandle),
    },
  }
}
