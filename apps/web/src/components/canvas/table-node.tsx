import type { NodeProps } from '@xyflow/react'
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect } from 'react'

import { useForgeStore } from '../../hooks/use-forge-store.ts'
import type { TableFlowNode } from '../../lib/canvas/to-flow.ts'
import { formatColumnType } from '../../lib/column-types.ts'

export function TableNode({ id, data }: NodeProps<TableFlowNode>) {
  const table = useForgeStore((state) =>
    state.schema.tables.find((candidate) => candidate.id === data.tableId)
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
    <div className='table-node'>
      <div className='table-node__title'>{table.name || '(unnamed)'}</div>
      <ul className='table-node__columns'>
        {table.columns.map((column) => (
          <li key={column.id} className='table-node__column'>
            <Handle type='target' position={Position.Left} id={column.id} />
            {table.primaryKey.includes(column.id) && (
              <span className='table-node__badge'>PK</span>
            )}
            <span className='table-node__name'>
              {column.name || '(unnamed)'}
            </span>
            <span className='table-node__type'>
              {formatColumnType(column.type)}
            </span>
            <Handle type='source' position={Position.Right} id={column.id} />
          </li>
        ))}
      </ul>
    </div>
  )
}
