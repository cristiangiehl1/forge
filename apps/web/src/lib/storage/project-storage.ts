export const PROJECT_STORAGE_KEY = 'forge:project'

/** Where the serialized project lives. Both methods may throw. */
export interface ProjectStorage {
  read(): string | null
  write(value: string): void
}

/** The part of the Web Storage API the adapter needs. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
