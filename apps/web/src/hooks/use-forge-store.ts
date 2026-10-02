import { useStore } from 'zustand'

import { connectSettings } from '../lib/settings/connect-settings.ts'
import { localStorageSettings } from '../lib/storage/default-storage.ts'
import type { ForgeState } from '../lib/store/forge-store.ts'
import { createForgeStore } from '../lib/store/forge-store.ts'

/** The app's only store. `randomUUID` needs HTTPS or localhost, which holds. */
export const forgeStore = createForgeStore({
  newId: () => crypto.randomUUID(),
})

// Loaded before the first render, saved the moment they change.
connectSettings(forgeStore, localStorageSettings)

export function useForgeStore<T>(selector: (state: ForgeState) => T): T {
  return useStore(forgeStore, selector)
}
