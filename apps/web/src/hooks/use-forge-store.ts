import { useStore } from 'zustand'

import type { ForgeState } from '../lib/store/forge-store.ts'
import { createForgeStore } from '../lib/store/forge-store.ts'

/** The app's only store. `randomUUID` needs HTTPS or localhost, which holds. */
export const forgeStore = createForgeStore({
  newId: () => crypto.randomUUID(),
})

export function useForgeStore<T>(selector: (state: ForgeState) => T): T {
  return useStore(forgeStore, selector)
}
