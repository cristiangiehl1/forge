import { forgeStore } from '../../hooks/use-forge-store.ts'

interface ToolbarProps {
  ddlOpen: boolean
  onToggleDdl: () => void
}

export function Toolbar({ ddlOpen, onToggleDdl }: ToolbarProps) {
  return (
    <header className='toolbar'>
      <h1 className='toolbar__title'>Forge</h1>
      <button type='button' onClick={() => forgeStore.getState().addTable()}>
        New table
      </button>
      <button type='button' aria-pressed={ddlOpen} onClick={onToggleDdl}>
        {ddlOpen ? 'Hide DDL' : 'Show DDL'}
      </button>
    </header>
  )
}
