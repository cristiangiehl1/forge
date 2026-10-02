import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import type { NewTableId } from '../../lib/settings/settings.ts'
import { NEW_TABLE_ID_CHOICES } from '../../lib/settings/settings.ts'

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
  const newTableId = useForgeStore((state) => state.settings.newTableId)

  return (
    <header className='toolbar'>
      <h1 className='toolbar__title'>Forge</h1>
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
      <button type='button' aria-pressed={ddlOpen} onClick={onToggleDdl}>
        {ddlOpen ? 'Hide DDL' : 'Show DDL'}
      </button>
    </header>
  )
}
