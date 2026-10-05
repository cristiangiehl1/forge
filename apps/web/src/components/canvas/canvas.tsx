import { checkRelationship } from '@forge/core'
import type { Connection, Edge, EdgeChange, NodeChange } from '@xyflow/react'
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect } from 'react'

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
  resolvePositions,
  toFlowEdges,
  toFlowNodes,
} from '../../lib/canvas/to-flow.ts'
import { routeRelationships } from '../../lib/routing/route-relationships.ts'
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

// Frames every table after an auto-arrange or a loaded example. It lives inside
// <ReactFlow> to reach the instance, and waits a frame for the nodes to be measured.
function FitOnRequest() {
  const { fitView } = useReactFlow()
  const fitRequest = useForgeStore((state) => state.fitRequest)
  useEffect(() => {
    if (fitRequest === 0) return
    const frame = requestAnimationFrame(() =>
      fitView({ padding: 0.15, duration: 0 })
    )
    return () => cancelAnimationFrame(frame)
  }, [fitRequest, fitView])
  return null
}

export function Canvas() {
  const schema = useForgeStore((state) => state.schema)
  const view = useForgeStore((state) => state.view)
  const selection = useForgeStore((state) => state.selection)
  const relationshipSelection = useForgeStore(
    (state) => state.relationshipSelection
  )

  const hoveredTable = useForgeStore((state) => state.hoveredTable)
  const projectEpoch = useForgeStore((state) => state.projectEpoch)

  const nodes = stableNodes(toFlowNodes(schema, view, selection))
  // Routing is the costly part and depends on the schema and the positions only;
  // hover and selection just restyle the edges that come out of it.
  const routes = routeRelationships(schema, resolvePositions(schema, view))
  const edges = stableEdges(
    toFlowEdges(schema, routes, relationshipSelection, hoveredTable)
  )

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
      // The default floor of 0.5 is too high for a project of fifty tables.
      minZoom={0.05}
      connectionMode={ConnectionMode.Loose}
      onNodesChange={(changes: NodeChange<TableFlowNode>[]) =>
        forwardNodeChanges(changes, canvasActions)
      }
      onEdgesChange={(changes: EdgeChange[]) =>
        forwardEdgeChanges(changes, canvasActions)
      }
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onNodeMouseEnter={(_, node) => forgeStore.getState().hoverTable(node.id)}
      onNodeMouseLeave={() => forgeStore.getState().hoverTable(null)}
      onNodeClick={(_, node) => forgeStore.getState().select(node.id)}
      onPaneClick={() => forgeStore.getState().clearSelection()}
      onMoveEnd={(_, viewport) => forgeStore.getState().setViewport(viewport)}
      defaultViewport={view.viewport}
      deleteKeyCode={['Backspace', 'Delete']}
      onBeforeDelete={async (deletion) => edgesOnly(deletion)}
      colorMode='system'>
      <FitOnRequest />
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
