import type { Schema, UserType } from '@forge/core'
import { typeUsages } from '@forge/core'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import {
  COLUMN_KINDS,
  choiceOf,
  kindLabel,
  typeFromChoice,
} from '../../lib/column-types.ts'
import { ConfirmButton } from '../confirm-button.tsx'

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
  const others = (schema.types ?? []).filter((other) => other.id !== type.id)

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
      {types.length === 0 && (
        <p className='inspector__hint'>
          No custom types. An enum lists its values; a domain narrows a base
          type.
        </p>
      )}
      <ul className='column-list'>
        {types.map((type) => (
          <TypeRow key={type.id} type={type} schema={schema} />
        ))}
      </ul>
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
    </>
  )
}
