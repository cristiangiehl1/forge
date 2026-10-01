import { createLocalStorageAdapter } from './local-storage-adapter.ts'
import { SETTINGS_STORAGE_KEY } from './project-storage.ts'

export const localStorageProject = createLocalStorageAdapter(
  () => globalThis.localStorage
)

export const localStorageSettings = createLocalStorageAdapter(
  () => globalThis.localStorage,
  SETTINGS_STORAGE_KEY
)
