import { checkRelationship } from '@forge/core'
import type { Connection, Edge, EdgeChange, NodeChange } from '@xyflow/react'
import { Background, Controls, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import type { TableFlowNode } from '../../lib/canvas/to-flow.ts'
import {
  connectionToRefs,
  toFlowEdges,
  toFlowNodes,
} from '../../lib/canvas/to-flow.ts'
import { TableNode } from './table-node.tsx'

const nodeTypes = { table: TableNode }

export function Canvas() {
  const schema = useForgeStore((state) => state.schema)
  const view = useForgeStore((state) => state.view)
  const selection = useForgeStore((state) => state.selection)

  const nodes = toFlowNodes(schema, view, selection)
  const edges = toFlowEdges(schema)

  // Only moves and edge removals are applied: tables are created and deleted
  // from the toolbar and the inspector, never by a keypress on the canvas.
  function onNodesChange(changes: NodeChange<TableFlowNode>[]) {
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        forgeStore.getState().moveNode(change.id, change.position)
      }
    }
  }

  function onEdgesChange(changes: EdgeChange[]) {
    for (const change of changes) {
      if (change.type === 'remove') {
        forgeStore.getState().removeRelationship(change.id)
      }
    }
  }

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

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onNodeClick={(_, node) => forgeStore.getState().select(node.id)}
      onPaneClick={() => forgeStore.getState().select(null)}
      onMoveEnd={(_, viewport) => forgeStore.getState().setViewport(viewport)}
      defaultViewport={view.viewport}
      colorMode='system'>
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
