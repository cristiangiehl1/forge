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

const NEW_TABLE_ID_LABELS: Record<NewTableId, string> = {
  integer: 'id: integer (auto-increment)',
  uuid: 'id: uuid (generated)',
  none: 'no id column',
}

export function Toolbar({ ddlOpen, onToggleDdl }: ToolbarProps) {
  const [importing, setImporting] = useState(false)
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
