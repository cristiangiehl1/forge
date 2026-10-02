import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { Canvas } from '../components/canvas/canvas.tsx'
import { DdlPanel } from '../components/ddl/ddl-panel.tsx'
import { Inspector } from '../components/inspector/inspector.tsx'
import { StartupNotice } from '../components/startup-notice.tsx'
import { Toolbar } from '../components/toolbar/toolbar.tsx'
import { useAutosave } from '../hooks/use-autosave.ts'
import { forgeStore, useForgeStore } from '../hooks/use-forge-store.ts'
import { useHistoryShortcuts } from '../hooks/use-history-shortcuts.ts'
import { useLoadProject } from '../queries/project/use-load-project.ts'

export const Route = createFileRoute('/')({
  component: EditorPage,
})

function EditorPage() {
  const load = useLoadProject()
  const hydrated = useForgeStore((state) => state.hydrated)

  useEffect(() => {
    if (load.data && !forgeStore.getState().hydrated) {
      forgeStore.getState().hydrate(load.data)
    }
  }, [load.data])

  if (!hydrated) return <p className='loading'>Loading…</p>
  return <Editor />
}

function Editor() {
  useHistoryShortcuts()
  const [ddlOpen, setDdlOpen] = useState(false)
  const saveError = useAutosave()

  return (
    <div className='app'>
      <Toolbar ddlOpen={ddlOpen} onToggleDdl={() => setDdlOpen(!ddlOpen)} />
      <StartupNotice />
      {saveError && (
        <div role='alert' className='banner banner--error'>
          Could not save the project: {saveError}
        </div>
      )}
      <div className='workspace'>
        <main className='main'>
          <div className='canvas'>
            <Canvas />
          </div>
          {ddlOpen && <DdlPanel />}
        </main>
        <Inspector />
      </div>
    </div>
  )
}
