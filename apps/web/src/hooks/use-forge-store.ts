import { useStore } from 'zustand'

import { loadSettings, saveSettings } from '../lib/settings/settings-storage.ts'
import { localStorageSettings } from '../lib/storage/default-storage.ts'
import type { ForgeState } from '../lib/store/forge-store.ts'
import { createForgeStore } from '../lib/store/forge-store.ts'

/** The app's only store. `randomUUID` needs HTTPS or localhost, which holds. */
export const forgeStore = createForgeStore({
  newId: () => crypto.randomUUID(),
})

// Settings are tiny and read synchronously, so they are loaded before the first
// render and saved the moment they change; no query is needed.
forgeStore.getState().hydrateSettings(loadSettings(localStorageSettings))
forgeStore.subscribe((state, previous) => {
  if (state.settings !== previous.settings) {
    saveSettings(localStorageSettings, state.settings)
  }
})

export function useForgeStore<T>(selector: (state: ForgeState) => T): T {
  return useStore(forgeStore, selector)
}
