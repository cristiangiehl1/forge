import type { Schema, UserType } from '@forge/core'
import {
  MAX_NUMERIC_PRECISION,
  MAX_VARCHAR_LENGTH,
  typeDependsOn,
  typeUsages,
} from '@forge/core'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import {
  COLUMN_KINDS,
  choiceOf,
  kindLabel,
  setNumericPrecision,
  setNumericScale,
  setVarcharLength,
  typeFromChoice,
} from '../../lib/column-types.ts'
import { ConfirmButton } from '../confirm-button.tsx'
import { NumberField } from './number-field.tsx'

/** Where a type is used, in words: `users.status`, or the domain's name. */
function describeUsages(schema: Schema, typeId: string): string[] {
  return typeUsages(schema, typeId).map((usage) => {
    if (usage.kind === 'domain') {
      return schema.types?.find((type) => type.id === usage.typeId)?.name ?? '?'
    }
    const table = schema.tables.find(
      (candidate) => candidate.id === usage.tableId
    )
    const column = table?.columns.find(
      (candidate) => candidate.id === usage.columnId
    )
    return `${table?.name ?? '?'}.${column?.name ?? '?'}`
  })
}

function TypeRow({ type, schema }: { type: UserType; schema: Schema }) {
  const { updateType, removeType } = forgeStore.getState()
  const usedBy = describeUsages(schema, type.id)
  // A domain cannot be based on itself, nor on a type that is based on it.
  const others = (schema.types ?? []).filter(
    (other) => other.id !== type.id && !typeDependsOn(schema, other.id, type.id)
  )

  return (
    <li className='type-row'>
      <input
        aria-label='Type name'
        value={type.name}
        onChange={(event) => updateType({ ...type, name: event.target.value })}
      />
      <span className='type-row__kind'>{type.kind}</span>
      {type.kind === 'enum' ? (
        <textarea
          aria-label='Enum values'
          rows={Math.max(2, type.values.length)}
          value={type.values.join('\n')}
          onChange={(event) =>
            updateType({ ...type, values: event.target.value.split('\n') })
          }
        />
      ) : (
        <>
          <select
            aria-label='Domain base type'
            value={choiceOf(type.base)}
            onChange={(event) =>
              updateType({
                ...type,
                base: typeFromChoice(event.target.value, false),
              })
            }>
            {COLUMN_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kindLabel(kind)}
              </option>
            ))}
            {others.length > 0 && (
              <optgroup label='Custom types'>
                {others.map((other) => (
                  <option key={other.id} value={`user:${other.id}`}>
                    {other.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {type.base.kind === 'varchar' && (
            <NumberField
              label='Length'
              value={type.base.length}
              min={1}
              max={MAX_VARCHAR_LENGTH}
              onCommit={(length) =>
                updateType({
                  ...type,
                  base: setVarcharLength(type.base, length),
                })
              }
            />
          )}
          {type.base.kind === 'char' && (
            <NumberField
              label='Length'
              value={type.base.length}
              min={1}
              max={MAX_VARCHAR_LENGTH}
              onCommit={(length) =>
                updateType({ ...type, base: { kind: 'char', length } })
              }
            />
          )}
          {type.base.kind === 'numeric' && (
            <>
              <NumberField
                label='Precision'
                value={type.base.precision}
                min={1}
                max={MAX_NUMERIC_PRECISION}
                onCommit={(precision) =>
                  updateType({
                    ...type,
                    base: setNumericPrecision(type.base, precision),
                  })
                }
              />
              <NumberField
                label='Scale'
                value={type.base.scale}
                min={0}
                max={type.base.precision}
                onCommit={(scale) =>
                  updateType({
                    ...type,
                    base: setNumericScale(type.base, scale),
                  })
                }
              />
            </>
          )}
          <label>
            <input
              type='checkbox'
              aria-label='Domain not null'
              checked={type.notNull === true}
              onChange={(event) =>
                updateType({ ...type, notNull: event.target.checked })
              }
            />
            NOT NULL
          </label>
          <input
            aria-label='Domain default'
            placeholder='default (SQL expression)'
            value={type.default ?? ''}
            onChange={(event) =>
              updateType({ ...type, default: event.target.value })
            }
          />
        </>
      )}
      {usedBy.length > 0 ? (
        <p className='inspector__hint'>Used by: {usedBy.join(', ')}</p>
      ) : (
        <ConfirmButton
          label='Remove type'
          armedLabel='Click again to delete'
          onConfirm={() => removeType(type.id)}
        />
      )}
    </li>
  )
}

export function TypesPanel() {
  const schema = useForgeStore((state) => state.schema)
  const types = schema.types ?? []
  return (
    <>
      <h2 className='inspector__heading'>Types</h2>
      <p className='inspector__hint'>
        An <strong>enum</strong> is a fixed list of values a column can hold
        (for example pending, paid, shipped). A <strong>domain</strong> is a
        base type with its own rules, such as NOT NULL and a default, that
        several columns can share (for example an email type built on text).
      </p>
      <ul className='column-list'>
        {types.map((type) => (
          <TypeRow key={type.id} type={type} schema={schema} />
        ))}
      </ul>
      <div className='inspector__actions'>
        <button
          type='button'
          onClick={() => forgeStore.getState().addType('enum')}>
          Add enum
        </button>
        <button
          type='button'
          onClick={() => forgeStore.getState().addType('domain')}>
          Add domain
        </button>
      </div>
    </>
  )
}
