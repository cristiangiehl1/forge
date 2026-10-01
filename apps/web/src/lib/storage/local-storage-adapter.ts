import type { ProjectStorage, StorageLike } from './project-storage.ts'
import { PROJECT_STORAGE_KEY } from './project-storage.ts'

/**
 * Takes a getter, not the storage itself: reaching for `localStorage` can throw
 * (blocked cookies, private modes), and that must happen inside `read`/`write`
 * where `loadProject`/`saveProject` catch it, not while the app starts.
 */
export function createLocalStorageAdapter(
  getStorage: () => StorageLike,
  key: string = PROJECT_STORAGE_KEY
): ProjectStorage {
  return {
    read: () => getStorage().getItem(key),
    write: (value) => getStorage().setItem(key, value),
  }
}
