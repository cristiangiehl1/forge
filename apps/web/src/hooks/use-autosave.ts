import { createProject } from '@forge/core'
import { useEffect } from 'react'

import { localStorageProject } from '../lib/storage/default-storage.ts'
import { saveProject } from '../queries/project/save-project.ts'
import { useSaveProject } from '../queries/project/use-save-project.ts'
import { forgeStore, useForgeStore } from './use-forge-store.ts'

const AUTOSAVE_DELAY_MS = 500

/**
 * Saves the project shortly after it stops changing. Nothing is saved while
 * persistence is blocked (the stored project was unreadable and is left as is).
 * Returns the message of the last save error, or null.
 */
export function useAutosave(): string | null {
  const schema = useForgeStore((state) => state.schema)
  const view = useForgeStore((state) => state.view)
  const persistence = useForgeStore((state) => state.persistence)
  const dialect = useForgeStore((state) => state.dialect)
  const dialectOptions = useForgeStore((state) => state.dialectOptions)
  const { mutate, isError, error } = useSaveProject()

  useEffect(() => {
    if (persistence !== 'ready') return
    const timer = setTimeout(
      () =>
        mutate(
          createProject(schema, view, { dialect, options: dialectOptions })
        ),
      AUTOSAVE_DELAY_MS
    )
    return () => clearTimeout(timer)
  }, [schema, view, persistence, dialect, dialectOptions, mutate])

  // A change made in the last half second would otherwise be lost on close.
  useEffect(() => {
    function flush() {
      const state = forgeStore.getState()
      if (state.persistence !== 'ready') return
      saveProject(
        localStorageProject,
        createProject(state.schema, state.view, {
          dialect: state.dialect,
          options: state.dialectOptions,
        })
      )
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  return isError ? error.message : null
}
