import type { ColumnRef, Schema, TableId } from '@forge/core'
import type { Edge, Node } from '@xyflow/react'

import type { ProjectView } from '../project-view.ts'
import { nextNodePosition } from '../project-view.ts'

/** A table node references a table by id and holds no schema data. */
export type TableNodeData = { tableId: TableId }

export type TableFlowNode = Node<TableNodeData, 'table'>

export function toFlowNodes(
  schema: Schema,
  view: ProjectView,
  selection: TableId | null
): TableFlowNode[] {
  return schema.tables.map((table, index) => ({
    id: table.id,
    type: 'table',
    position: view.nodes[table.id] ?? nextNodePosition(index),
    data: { tableId: table.id },
    selected: table.id === selection,
  }))
}

/** One edge per relationship; the handle ids are the column ids. */
export function toFlowEdges(schema: Schema): Edge[] {
  return schema.relationships.map((relationship) => ({
    id: relationship.id,
    source: relationship.from.tableId,
    sourceHandle: relationship.from.columnId,
    target: relationship.to.tableId,
    targetHandle: relationship.to.columnId,
  }))
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
    from: { tableId: connection.source, columnId: connection.sourceHandle },
    to: { tableId: connection.target, columnId: connection.targetHandle },
  }
}
