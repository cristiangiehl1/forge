import type { StoreApi } from 'zustand'

import type { ProjectStorage } from '../storage/project-storage.ts'
import type { ForgeState } from '../store/forge-store.ts'
import { loadSettings, saveSettings } from './settings-storage.ts'

/**
 * Settings are tiny and read synchronously, so they are loaded before the first
 * render and saved the moment they change. Loading comes first and the
 * subscription second, so starting up never writes. Returns a function that
 * stops saving.
 */
export function connectSettings(
  store: Pick<StoreApi<ForgeState>, 'getState' | 'subscribe'>,
  storage: ProjectStorage
): () => void {
  store.getState().hydrateSettings(loadSettings(storage))
  return store.subscribe((state, previous) => {
    if (state.settings !== previous.settings) {
      saveSettings(storage, state.settings)
    }
  })
}
