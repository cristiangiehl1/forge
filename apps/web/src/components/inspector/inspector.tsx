import type { Column, Table } from '@forge/core'
import { MAX_NUMERIC_PRECISION, MAX_VARCHAR_LENGTH } from '@forge/core'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import {
  baseType,
  COLUMN_KINDS,
  choiceOf,
  kindLabel,
  mapBase,
  setNumericPrecision,
  setNumericScale,
  setVarcharLength,
  typeFromChoice,
  withArray,
} from '../../lib/column-types.ts'
import {
  impliesNotNull,
  showsGeneratedToggle,
  typeChangePatch,
} from '../../lib/generated.ts'
import { nextPrimaryKey } from '../../lib/primary-key.ts'
import { relationshipsOf } from '../../lib/relationships.ts'
import { ConfirmButton } from '../confirm-button.tsx'
import { IndexList } from './index-list.tsx'
import { NumberField } from './number-field.tsx'
import { TypesPanel } from './types-panel.tsx'

function ColumnRow({ table, column }: { table: Table; column: Column }) {
  const { updateColumn, removeColumn, setPrimaryKey } = forgeStore.getState()
  const isPrimaryKey = table.primaryKey.includes(column.id)
  const notNullIsForced = isPrimaryKey || impliesNotNull(column)
  const userTypes = useForgeStore((state) => state.schema.types) ?? []
  const base = baseType(column.type)

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
        value={choiceOf(column.type)}
        onChange={(event) =>
          updateColumn(
            table.id,
            column.id,
            typeChangePatch(
              column,
              typeFromChoice(event.target.value, column.type.kind === 'array')
            )
          )
        }>
        {COLUMN_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {kindLabel(kind)}
          </option>
        ))}
        {userTypes.length > 0 && (
          <optgroup label='Custom types'>
            {userTypes.map((type) => (
              <option key={type.id} value={`user:${type.id}`}>
                {type.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <label>
        <input
          type='checkbox'
          aria-label='Array'
          checked={column.type.kind === 'array'}
          onChange={(event) =>
            updateColumn(
              table.id,
              column.id,
              typeChangePatch(
                column,
                withArray(column.type, event.target.checked)
              )
            )
          }
        />
        Array
      </label>
      {(base.kind === 'varchar' || base.kind === 'char') && (
        <NumberField
          label='Length'
          value={base.length}
          min={1}
          max={MAX_VARCHAR_LENGTH}
          onCommit={(length) =>
            updateColumn(table.id, column.id, {
              type: mapBase(column.type, (current) =>
                current.kind === 'char'
                  ? { kind: 'char', length }
                  : setVarcharLength(current, length)
              ),
            })
          }
        />
      )}
      {base.kind === 'numeric' && (
        <>
          <NumberField
            label='Precision'
            value={base.precision}
            min={1}
            max={MAX_NUMERIC_PRECISION}
            onCommit={(precision) =>
              updateColumn(table.id, column.id, {
                type: mapBase(column.type, (current) =>
                  setNumericPrecision(current, precision)
                ),
              })
            }
          />
          <NumberField
            label='Scale'
            value={base.scale}
            min={0}
            max={base.precision}
            onCommit={(scale) =>
              updateColumn(table.id, column.id, {
                type: mapBase(column.type, (current) =>
                  setNumericScale(current, scale)
                ),
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
                ...(event.target.checked ? { default: '' } : {}),
              })
            }
          />
          Auto-generate
        </label>
      )}
      <div className='column-row__extra'>
        <input
          aria-label='Column default'
          placeholder='default (SQL expression)'
          value={column.default ?? ''}
          disabled={column.generated === true}
          onChange={(event) =>
            updateColumn(table.id, column.id, { default: event.target.value })
          }
        />
        <input
          aria-label='Column comment'
          placeholder='comment'
          value={column.comment ?? ''}
          onChange={(event) =>
            updateColumn(table.id, column.id, { comment: event.target.value })
          }
        />
      </div>
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
  const {
    renameTable,
    removeTable,
    addColumn,
    removeRelationship,
    setTableComment,
  } = forgeStore.getState()

  if (!table) {
    return (
      <aside className='inspector'>
        <p className='inspector__hint'>
          Select a table to edit it, or add a new one from the toolbar. To look
          around first, load the example project.
        </p>
        <TypesPanel />
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
      <label className='field'>
        Table comment
        <input
          aria-label='Table comment'
          value={table.comment ?? ''}
          onChange={(event) => setTableComment(table.id, event.target.value)}
        />
      </label>
      <h2 className='inspector__heading'>Columns</h2>
      <ul className='column-list'>
        {table.columns.map((column) => (
          <ColumnRow key={column.id} table={table} column={column} />
        ))}
      </ul>
      <IndexList table={table} />
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
        <ConfirmButton
          key={table.id}
          className='danger'
          label='Delete table'
          armedLabel='Click again to delete'
          onConfirm={() => removeTable(table.id)}
        />
      </div>
    </aside>
  )
}
