import type { EdgeProps } from '@xyflow/react'
import { BaseEdge, EdgeLabelRenderer } from '@xyflow/react'

import { forgeStore } from '../../hooks/use-forge-store.ts'
import type { RelationshipFlowEdge } from '../../lib/canvas/to-flow.ts'
import { pathFromPoints, pointAlong } from '../../lib/routing/path.ts'

/** A relationship line. Once selected, it shows a button to remove it. */
export function RelationshipEdge({
  id,
  data,
  selected,
  markerEnd,
  style,
}: EdgeProps<RelationshipFlowEdge>) {
  // The route was worked out round the tables (lib/routing); React Flow's own
  // endpoints are ignored so the line never cuts across a table.
  const points = data?.points ?? []
  const path = pathFromPoints(points)
  const { x: labelX, y: labelY } = pointAlong(points, 0.5)

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={24}
      />
      {selected && (
        <EdgeLabelRenderer>
          <button
            type='button'
            className='edge-delete nodrag nopan'
            aria-label='Remove relationship'
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            onClick={() => forgeStore.getState().removeRelationship(id)}>
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
