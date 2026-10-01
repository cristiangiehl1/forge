import type { EdgeProps } from '@xyflow/react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react'

import { forgeStore } from '../../hooks/use-forge-store.ts'

/** A relationship line. Once selected, it shows a button to remove it. */
export function RelationshipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
  style,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

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
