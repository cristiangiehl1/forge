import type { DialectId } from '@forge/core'
import { DIALECT_IDS } from '@forge/core'
import { useState } from 'react'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import { canRedo, canUndo } from '../../lib/history/history.ts'
import type { NewTableId } from '../../lib/settings/settings.ts'
import { NEW_TABLE_ID_CHOICES } from '../../lib/settings/settings.ts'
import { ConfirmButton } from '../confirm-button.tsx'
import { ImportDialog } from '../import/import-dialog.tsx'

interface ToolbarProps {
  ddlOpen: boolean
  onToggleDdl: () => void
}

const DIALECT_LABELS: Record<DialectId, string> = {
  postgres: 'PostgreSQL',
  oracle: 'Oracle',
}

const NEW_TABLE_ID_LABELS: Record<NewTableId, string> = {
  integer: 'id: integer (auto-increment)',
  uuid: 'id: uuid (generated)',
  none: 'no id column',
}

export function Toolbar({ ddlOpen, onToggleDdl }: ToolbarProps) {
  const [importing, setImporting] = useState(false)
  const dialect = useForgeStore((state) => state.dialect)
  const dialectOptions = useForgeStore((state) => state.dialectOptions)
  const undoable = useForgeStore((state) => canUndo(state.history))
  const redoable = useForgeStore((state) => canRedo(state.history))
  const newTableId = useForgeStore((state) => state.settings.newTableId)
  const newTableTimestamps = useForgeStore(
    (state) => state.settings.newTableTimestamps
  )
  const hasTables = useForgeStore((state) => state.schema.tables.length > 0)

  return (
    <header className='toolbar'>
      <h1 className='toolbar__title'>Forge</h1>
      <button
        type='button'
        disabled={!undoable}
        title='Undo (Ctrl+Z)'
        onClick={() => forgeStore.getState().undo()}>
        Undo
      </button>
      <button
        type='button'
        disabled={!redoable}
        title='Redo (Ctrl+Shift+Z)'
        onClick={() => forgeStore.getState().redo()}>
        Redo
      </button>
      <button type='button' onClick={() => forgeStore.getState().addTable()}>
        New table
      </button>
      <label className='toolbar__field'>
        New tables start with
        <select
          value={newTableId}
          onChange={(event) =>
            forgeStore
              .getState()
              .setNewTableId(event.target.value as NewTableId)
          }>
          {NEW_TABLE_ID_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {NEW_TABLE_ID_LABELS[choice]}
            </option>
          ))}
        </select>
      </label>
      <label className='toolbar__field'>
        <input
          type='checkbox'
          checked={newTableTimestamps}
          onChange={(event) =>
            forgeStore.getState().setNewTableTimestamps(event.target.checked)
          }
        />
        created_at / updated_at on new tables
      </label>
      <label className='toolbar__field'>
        Dialect
        <select
          aria-label='Dialect'
          value={dialect}
          onChange={(event) =>
            forgeStore.getState().setDialect(event.target.value as DialectId)
          }>
          {DIALECT_IDS.map((id) => (
            <option key={id} value={id}>
              {DIALECT_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
      {dialect === 'oracle' && (
        <label className='toolbar__field'>
          uuid as
          <select
            aria-label='Oracle uuid'
            value={dialectOptions.uuid ?? 'raw16'}
            onChange={(event) =>
              forgeStore.getState().setDialectOptions({
                ...dialectOptions,
                uuid: event.target.value as 'raw16' | 'varchar36',
              })
            }>
            <option value='raw16'>RAW(16)</option>
            <option value='varchar36'>VARCHAR2(36)</option>
          </select>
        </label>
      )}
      {hasTables ? (
        <ConfirmButton
          label='Load example'
          armedLabel='Replace the project with the example?'
          onConfirm={() => forgeStore.getState().loadExample()}
        />
      ) : (
        <button
          type='button'
          onClick={() => forgeStore.getState().loadExample()}>
          Load example
        </button>
      )}
      {hasTables ? (
        <ConfirmButton
          label='Load recruitment example'
          armedLabel='Replace the project with the recruitment example?'
          onConfirm={() => forgeStore.getState().loadExample('recruitment')}
        />
      ) : (
        <button
          type='button'
          onClick={() => forgeStore.getState().loadExample('recruitment')}>
          Load recruitment example
        </button>
      )}
      <button
        type='button'
        disabled={!hasTables}
        onClick={() => forgeStore.getState().autoLayout()}>
        Auto-arrange
      </button>
      <button type='button' onClick={() => setImporting(true)}>
        Import SQL
      </button>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      <button type='button' aria-pressed={ddlOpen} onClick={onToggleDdl}>
        {ddlOpen ? 'Hide DDL' : 'Show DDL'}
      </button>
    </header>
  )
}
