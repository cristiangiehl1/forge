import { createLocalStorageAdapter } from './local-storage-adapter.ts'

export const localStorageProject = createLocalStorageAdapter(
  () => globalThis.localStorage
)
