import { createFileRoute } from '@tanstack/react-router'
import { ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

export const Route = createFileRoute('/')({
  component: CanvasPage,
})

function CanvasPage() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow nodes={[]} edges={[]} />
    </div>
  )
}
