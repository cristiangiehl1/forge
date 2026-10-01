import type { ProjectStorage } from '../../lib/storage/project-storage.ts'

export interface MemoryStorage extends ProjectStorage {
  /** The stored value, without going through `read`. */
  peek(): string | null
}

export function memoryStorage(initial: string | null = null): MemoryStorage {
  let value = initial
  return {
    read: () => value,
    write: (next) => {
      value = next
    },
    peek: () => value,
  }
}

/** Both `read` and `write` throw, like storage that is blocked outright. */
export function brokenStorage(message: string): ProjectStorage {
  const fail = (): never => {
    throw new Error(message)
  }
  return { read: fail, write: fail }
}

/** `read` works and `write` throws, like a full `localStorage`. */
export function quotaStorage(
  initial: string | null,
  message: string
): MemoryStorage {
  return {
    read: () => initial,
    write: () => {
      throw new Error(message)
    },
    peek: () => initial,
  }
}
