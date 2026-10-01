import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createLocalStorageAdapter } from '../../../../lib/storage/local-storage-adapter.ts'
import {
  PROJECT_STORAGE_KEY,
  type StorageLike,
} from '../../../../lib/storage/project-storage.ts'

function fakeStorage() {
  const data = new Map<string, string>()
  const storage: StorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
  return { data, storage }
}

describe('createLocalStorageAdapter', () => {
  it('reads and writes under the forge:project key', () => {
    const { data, storage } = fakeStorage()
    const adapter = createLocalStorageAdapter(() => storage)

    assert.equal(PROJECT_STORAGE_KEY, 'forge:project')
    assert.equal(adapter.read(), null)
    adapter.write('{"a":1}')
    assert.equal(data.get('forge:project'), '{"a":1}')
    assert.equal(adapter.read(), '{"a":1}')
  })

  it('does not touch the storage until it is used', () => {
    let touched = false
    createLocalStorageAdapter(() => {
      touched = true
      return fakeStorage().storage
    })
    assert.equal(touched, false)
  })

  it('lets an error thrown by the storage propagate', () => {
    const adapter = createLocalStorageAdapter(() => {
      throw new Error('SecurityError')
    })
    assert.throws(() => adapter.read(), /SecurityError/)
    assert.throws(() => adapter.write('x'), /SecurityError/)
  })
})
