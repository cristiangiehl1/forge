import type { NodeProps } from '@xyflow/react'
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect } from 'react'

import { useForgeStore } from '../../hooks/use-forge-store.ts'
import type { TableFlowNode } from '../../lib/canvas/to-flow.ts'
import { handleId } from '../../lib/canvas/to-flow.ts'
import { formatColumnType } from '../../lib/column-types.ts'
import type { Side } from '../../lib/geometry.ts'
import { relatedTables } from '../../lib/relationships.ts'

/**
 * A connection point on one side of a column row. A source and a target sit on the
 * same spot with the same id, so a line can start or end there, whichever side its
 * route chose.
 */
function SideHandles({ columnId, side }: { columnId: string; side: Side }) {
  const position = side === 'l' ? Position.Left : Position.Right
  const id = handleId(columnId, side)
  return (
    <>
      <Handle type='target' position={position} id={id} />
      <Handle type='source' position={position} id={id} />
    </>
  )
}

export function TableNode({ id, data }: NodeProps<TableFlowNode>) {
  const table = useForgeStore((state) =>
    state.schema.tables.find((candidate) => candidate.id === data.tableId)
  )
  const hovered = useForgeStore((state) => state.hoveredTable === data.tableId)
  const relatedToHovered = useForgeStore(
    (state) =>
      state.hoveredTable !== null &&
      state.hoveredTable !== data.tableId &&
      relatedTables(state.schema, state.hoveredTable).has(data.tableId)
  )
  const updateNodeInternals = useUpdateNodeInternals()

  // React Flow measures handle positions once; adding, removing or reordering
  // columns changes them, so it has to be told (ADR-0002 of the web app).
  const columnKey = table?.columns.map((column) => column.id).join('|') ?? ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: columnKey is the trigger, not a value read inside
  useEffect(() => {
    updateNodeInternals(id)
  }, [columnKey, id, updateNodeInternals])

  if (!table) return null

  return (
    <div
      className={
        hovered
          ? 'table-node table-node--hovered'
          : relatedToHovered
            ? 'table-node table-node--related-hover'
            : 'table-node'
      }>
      <div className='table-node__title'>{table.name || '(unnamed)'}</div>
      <ul className='table-node__columns'>
        {table.columns.map((column) => (
          <li key={column.id} className='table-node__column'>
            <SideHandles columnId={column.id} side='l' />
            {table.primaryKey.includes(column.id) && (
              <span className='table-node__badge'>PK</span>
            )}
            {column.generated && (
              <span className='table-node__badge table-node__badge--auto'>
                auto
              </span>
            )}
            <span className='table-node__name'>
              {column.name || '(unnamed)'}
            </span>
            <span className='table-node__type'>
              {formatColumnType(column.type)}
            </span>
            <SideHandles columnId={column.id} side='r' />
          </li>
        ))}
      </ul>
    </div>
  )
}
