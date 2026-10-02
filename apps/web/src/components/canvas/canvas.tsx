import { checkRelationship } from '@forge/core'
import type { Connection, Edge, EdgeChange, NodeChange } from '@xyflow/react'
import { Background, Controls, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import { edgesOnly } from '../../lib/canvas/deletion-guard.ts'
import type { CanvasActions } from '../../lib/canvas/forward-changes.ts'
import {
  forwardEdgeChanges,
  forwardNodeChanges,
} from '../../lib/canvas/forward-changes.ts'
import {
  createStabilizer,
  sameEdge,
  sameNode,
} from '../../lib/canvas/stabilize.ts'
import type { TableFlowNode } from '../../lib/canvas/to-flow.ts'
import {
  connectionToRefs,
  toFlowEdges,
  toFlowNodes,
} from '../../lib/canvas/to-flow.ts'
import { RelationshipEdge } from './relationship-edge.tsx'
import { TableNode } from './table-node.tsx'

const nodeTypes = { table: TableNode }

// Keep the previous node and edge objects for whatever did not change, so React
// Flow does not re-render every table on every keystroke in the inspector.
const stableNodes = createStabilizer(sameNode)
const stableEdges = createStabilizer(sameEdge)
const edgeTypes = { relationship: RelationshipEdge }

const canvasActions: CanvasActions = {
  moveNode: (tableId, position) =>
    forgeStore.getState().moveNode(tableId, position),
  select: (tableId) => forgeStore.getState().select(tableId),
  removeRelationship: (relationshipId) =>
    forgeStore.getState().removeRelationship(relationshipId),
  currentSelection: () => forgeStore.getState().selection,
  selectRelationship: (relationshipId) =>
    forgeStore.getState().selectRelationship(relationshipId),
  currentRelationshipSelection: () =>
    forgeStore.getState().relationshipSelection,
}

export function Canvas() {
  const schema = useForgeStore((state) => state.schema)
  const view = useForgeStore((state) => state.view)
  const selection = useForgeStore((state) => state.selection)
  const relationshipSelection = useForgeStore(
    (state) => state.relationshipSelection
  )

  const projectEpoch = useForgeStore((state) => state.projectEpoch)

  const nodes = stableNodes(toFlowNodes(schema, view, selection))
  const edges = stableEdges(toFlowEdges(schema, relationshipSelection))

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

  // Delete/Backspace removes a selected relationship, and nothing else:
  // `onBeforeDelete` refuses any deletion that includes a table. Without that,
  // Backspace with a table selected deleted every relationship touching it
  // (and kept the table), silently. Tables are removed from the inspector.
  return (
    <ReactFlow
      // A new project starts with a fresh canvas, viewport included.
      key={projectEpoch}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={(changes: NodeChange<TableFlowNode>[]) =>
        forwardNodeChanges(changes, canvasActions)
      }
      onEdgesChange={(changes: EdgeChange[]) =>
        forwardEdgeChanges(changes, canvasActions)
      }
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onNodeClick={(_, node) => forgeStore.getState().select(node.id)}
      onPaneClick={() => forgeStore.getState().clearSelection()}
      onMoveEnd={(_, viewport) => forgeStore.getState().setViewport(viewport)}
      defaultViewport={view.viewport}
      deleteKeyCode={['Backspace', 'Delete']}
      onBeforeDelete={async (deletion) => edgesOnly(deletion)}
      colorMode='system'>
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
