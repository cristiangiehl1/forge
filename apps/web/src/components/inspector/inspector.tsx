import type { Column, Table } from '@forge/core'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import type { ColumnKind } from '../../lib/column-types.ts'
import {
  COLUMN_KINDS,
  defaultColumnType,
  setNumericPrecision,
  setNumericScale,
  setVarcharLength,
} from '../../lib/column-types.ts'
import { nextPrimaryKey } from '../../lib/primary-key.ts'

function ColumnRow({ table, column }: { table: Table; column: Column }) {
  const { updateColumn, removeColumn, setPrimaryKey } = forgeStore.getState()
  const isPrimaryKey = table.primaryKey.includes(column.id)

  return (
    <li className='column-row'>
      <input
        aria-label='Column name'
        value={column.name}
        onChange={(event) =>
          updateColumn(table.id, column.id, { name: event.target.value })
        }
      />
      <select
        aria-label='Column type'
        value={column.type.kind}
        onChange={(event) =>
          updateColumn(table.id, column.id, {
            type: defaultColumnType(event.target.value as ColumnKind),
          })
        }>
        {COLUMN_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {kind}
          </option>
        ))}
      </select>
      {column.type.kind === 'varchar' && (
        <input
          aria-label='Length'
          type='number'
          min={1}
          value={column.type.length}
          onChange={(event) => {
            if (event.target.value === '') return
            updateColumn(table.id, column.id, {
              type: setVarcharLength(column.type, Number(event.target.value)),
            })
          }}
        />
      )}
      {column.type.kind === 'numeric' && (
        <>
          <input
            aria-label='Precision'
            type='number'
            min={1}
            value={column.type.precision}
            onChange={(event) => {
              if (event.target.value === '') return
              updateColumn(table.id, column.id, {
                type: setNumericPrecision(
                  column.type,
                  Number(event.target.value)
                ),
              })
            }}
          />
          <input
            aria-label='Scale'
            type='number'
            min={0}
            value={column.type.scale}
            onChange={(event) => {
              if (event.target.value === '') return
              updateColumn(table.id, column.id, {
                type: setNumericScale(column.type, Number(event.target.value)),
              })
            }}
          />
        </>
      )}
      <label>
        <input
          type='checkbox'
          checked={isPrimaryKey}
          onChange={(event) =>
            setPrimaryKey(
              table.id,
              nextPrimaryKey(table, column.id, event.target.checked)
            )
          }
        />
        PK
      </label>
      <label>
        <input
          type='checkbox'
          checked={!column.nullable || isPrimaryKey}
          disabled={isPrimaryKey}
          onChange={(event) =>
            updateColumn(table.id, column.id, {
              nullable: !event.target.checked,
            })
          }
        />
        NOT NULL
      </label>
      <button
        type='button'
        aria-label='Remove column'
        onClick={() => removeColumn(table.id, column.id)}>
        ×
      </button>
    </li>
  )
}

export function Inspector() {
  const table = useForgeStore((state) =>
    state.schema.tables.find((candidate) => candidate.id === state.selection)
  )
  const { renameTable, removeTable, addColumn } = forgeStore.getState()

  if (!table) {
    return (
      <aside className='inspector'>
        <p className='inspector__hint'>
          Select a table to edit it, or add a new one from the toolbar.
        </p>
      </aside>
    )
  }

  return (
    <aside className='inspector'>
      <label className='field'>
        Table name
        <input
          value={table.name}
          onChange={(event) => renameTable(table.id, event.target.value)}
        />
      </label>
      <h2 className='inspector__heading'>Columns</h2>
      <ul className='column-list'>
        {table.columns.map((column) => (
          <ColumnRow key={column.id} table={table} column={column} />
        ))}
      </ul>
      <div className='inspector__actions'>
        <button type='button' onClick={() => addColumn(table.id)}>
          Add column
        </button>
        <button
          type='button'
          className='danger'
          onClick={() => removeTable(table.id)}>
          Delete table
        </button>
      </div>
    </aside>
  )
}
