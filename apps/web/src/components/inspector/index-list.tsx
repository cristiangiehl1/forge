import type { Index, Table } from '@forge/core'
import { INDEX_METHODS } from '@forge/core'

import { forgeStore } from '../../hooks/use-forge-store.ts'
import { ConfirmButton } from '../confirm-button.tsx'

function IndexRow({ table, index }: { table: Table; index: Index }) {
  const { updateIndex, removeIndex } = forgeStore.getState()
  const toggle = (columnId: string, on: boolean) =>
    updateIndex(table.id, index.id, {
      columns: on
        ? [...index.columns, columnId]
        : index.columns.filter((id) => id !== columnId),
    })

  return (
    <li className='index-row'>
      <input
        aria-label='Index name'
        value={index.name}
        onChange={(event) =>
          updateIndex(table.id, index.id, { name: event.target.value })
        }
      />
      <fieldset className='index-row__columns'>
        <legend>Index columns</legend>
        {table.columns.map((column) => (
          <label key={column.id}>
            <input
              type='checkbox'
              checked={index.columns.includes(column.id)}
              // An index needs a column: the last one stays checked.
              disabled={
                index.columns.length === 1 && index.columns[0] === column.id
              }
              onChange={(event) => toggle(column.id, event.target.checked)}
            />
            {column.name || '(unnamed)'}
          </label>
        ))}
      </fieldset>
      <label>
        <input
          type='checkbox'
          aria-label='Index unique'
          checked={index.unique}
          onChange={(event) =>
            updateIndex(table.id, index.id, { unique: event.target.checked })
          }
        />
        Unique
      </label>
      <select
        aria-label='Index method'
        value={index.method}
        onChange={(event) =>
          updateIndex(table.id, index.id, {
            method: event.target.value as Index['method'],
          })
        }>
        {INDEX_METHODS.map((method) => (
          <option key={method} value={method}>
            {method}
          </option>
        ))}
      </select>
      <ConfirmButton
        label='Remove index'
        armedLabel='Click again to delete'
        onConfirm={() => removeIndex(table.id, index.id)}
      />
    </li>
  )
}

export function IndexList({ table }: { table: Table }) {
  const indexes = table.indexes ?? []
  return (
    <>
      <h2 className='inspector__heading'>Indexes</h2>
      {indexes.length === 0 && (
        <p className='inspector__hint'>No indexes on this table.</p>
      )}
      <ul className='column-list'>
        {indexes.map((index) => (
          <IndexRow key={index.id} table={table} index={index} />
        ))}
      </ul>
      <div className='inspector__actions'>
        <button
          type='button'
          disabled={table.columns.length === 0}
          onClick={() => forgeStore.getState().addIndex(table.id)}>
          Add index
        </button>
      </div>
    </>
  )
}
