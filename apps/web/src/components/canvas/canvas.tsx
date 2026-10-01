import { checkRelationship } from '@forge/core'
import type { Connection, Edge, EdgeChange, NodeChange } from '@xyflow/react'
import { Background, Controls, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import type { CanvasActions } from '../../lib/canvas/forward-changes.ts'
import {
  forwardEdgeChanges,
  forwardNodeChanges,
} from '../../lib/canvas/forward-changes.ts'
import type { TableFlowNode } from '../../lib/canvas/to-flow.ts'
import {
  connectionToRefs,
  toFlowEdges,
  toFlowNodes,
} from '../../lib/canvas/to-flow.ts'
import { TableNode } from './table-node.tsx'

const nodeTypes = { table: TableNode }

const canvasActions: CanvasActions = {
  moveNode: (tableId, position) =>
    forgeStore.getState().moveNode(tableId, position),
  select: (tableId) => forgeStore.getState().select(tableId),
  removeRelationship: (relationshipId) =>
    forgeStore.getState().removeRelationship(relationshipId),
  currentSelection: () => forgeStore.getState().selection,
}

export function Canvas() {
  const schema = useForgeStore((state) => state.schema)
  const view = useForgeStore((state) => state.view)
  const selection = useForgeStore((state) => state.selection)

  const nodes = toFlowNodes(schema, view, selection)
  const edges = toFlowEdges(schema)

  function isValidConnection(connection: Connection | Edge) {
    const refs = connectionToRefs(connection)
    if (!refs) return false
    return (
      checkRelationship(forgeStore.getState().schema, refs.from, refs.to) ===
      null
    )
  }

  function onConnect(connection: Connection) {
    const refs = connectionToRefs(connection)
    if (refs) forgeStore.getState().connect(refs.from, refs.to)
  }

  // `deleteKeyCode={null}` turns off React Flow's keyboard deletion. With a table
  // selected, Backspace used to delete every relationship touching it (and keep
  // the table), silently. Tables and relationships are removed from the
  // inspector, where the action is visible.
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={(changes: NodeChange<TableFlowNode>[]) =>
        forwardNodeChanges(changes, canvasActions)
      }
      onEdgesChange={(changes: EdgeChange[]) =>
        forwardEdgeChanges(changes, canvasActions)
      }
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onNodeClick={(_, node) => forgeStore.getState().select(node.id)}
      onPaneClick={() => forgeStore.getState().select(null)}
      onMoveEnd={(_, viewport) => forgeStore.getState().setViewport(viewport)}
      defaultViewport={view.viewport}
      deleteKeyCode={null}
      colorMode='system'>
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
