import type { Column, Table } from '@forge/core'
import { MAX_NUMERIC_PRECISION, MAX_VARCHAR_LENGTH } from '@forge/core'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import type { ColumnKind } from '../../lib/column-types.ts'
import {
  COLUMN_KINDS,
  setNumericPrecision,
  setNumericScale,
  setVarcharLength,
} from '../../lib/column-types.ts'
import {
  impliesNotNull,
  showsGeneratedToggle,
  typeChangePatch,
} from '../../lib/generated.ts'
import { nextPrimaryKey } from '../../lib/primary-key.ts'
import { relationshipsOf } from '../../lib/relationships.ts'
import { DeleteTableButton } from './delete-table-button.tsx'
import { NumberField } from './number-field.tsx'

function ColumnRow({ table, column }: { table: Table; column: Column }) {
  const { updateColumn, removeColumn, setPrimaryKey } = forgeStore.getState()
  const isPrimaryKey = table.primaryKey.includes(column.id)
  const notNullIsForced = isPrimaryKey || impliesNotNull(column)

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
          updateColumn(
            table.id,
            column.id,
            typeChangePatch(column, event.target.value as ColumnKind)
          )
        }>
        {COLUMN_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {kind}
          </option>
        ))}
      </select>
      {column.type.kind === 'varchar' && (
        <NumberField
          label='Length'
          value={column.type.length}
          min={1}
          max={MAX_VARCHAR_LENGTH}
          onCommit={(length) =>
            updateColumn(table.id, column.id, {
              type: setVarcharLength(column.type, length),
            })
          }
        />
      )}
      {column.type.kind === 'numeric' && (
        <>
          <NumberField
            label='Precision'
            value={column.type.precision}
            min={1}
            max={MAX_NUMERIC_PRECISION}
            onCommit={(precision) =>
              updateColumn(table.id, column.id, {
                type: setNumericPrecision(column.type, precision),
              })
            }
          />
          <NumberField
            label='Scale'
            value={column.type.scale}
            min={0}
            max={column.type.precision}
            onCommit={(scale) =>
              updateColumn(table.id, column.id, {
                type: setNumericScale(column.type, scale),
              })
            }
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
          checked={!column.nullable || notNullIsForced}
          disabled={notNullIsForced}
          onChange={(event) =>
            updateColumn(table.id, column.id, {
              nullable: !event.target.checked,
            })
          }
        />
        NOT NULL
      </label>
      {showsGeneratedToggle(column) && (
        <label>
          <input
            type='checkbox'
            checked={column.generated === true}
            onChange={(event) =>
              updateColumn(table.id, column.id, {
                generated: event.target.checked,
              })
            }
          />
          Auto-generate
        </label>
      )}
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
  const schema = useForgeStore((state) => state.schema)
  const selectedRelationship = useForgeStore(
    (state) => state.relationshipSelection
  )
  const { renameTable, removeTable, addColumn, removeRelationship } =
    forgeStore.getState()

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
      <h2 className='inspector__heading'>Relationships</h2>
      {relationshipsOf(schema, table.id).length === 0 ? (
        <p className='inspector__hint'>
          Drag from a column handle to another column to relate them.
        </p>
      ) : (
        <ul className='column-list'>
          {relationshipsOf(schema, table.id).map((relationship) => (
            <li
              key={relationship.id}
              className={
                relationship.id === selectedRelationship
                  ? 'column-row column-row--selected'
                  : 'column-row'
              }>
              <span className='relationship-label'>{relationship.label}</span>
              <button
                type='button'
                aria-label={`Remove relationship ${relationship.label}`}
                onClick={() => removeRelationship(relationship.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className='inspector__actions'>
        <button type='button' onClick={() => addColumn(table.id)}>
          Add column
        </button>
        <DeleteTableButton
          key={table.id}
          onConfirm={() => removeTable(table.id)}
        />
      </div>
    </aside>
  )
}
