import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { connectSettings } from '../../../lib/settings/connect-settings.ts'
import { createForgeStore } from '../../../lib/store/forge-store.ts'
import { brokenStorage, memoryStorage } from '../../helpers/memory-storage.ts'

const makeStore = () => createForgeStore({ newId: () => 'id' })

function countingStorage(initial: string | null) {
  const inner = memoryStorage(initial)
  let writes = 0
  return {
    storage: {
      read: () => inner.read(),
      write: (value: string) => {
        writes++
        inner.write(value)
      },
    },
    writes: () => writes,
    peek: () => inner.peek(),
  }
}

describe('connectSettings', () => {
  it('loads the saved settings into the store before anything else', () => {
    const store = makeStore()
    connectSettings(store, memoryStorage('{"newTableId":"uuid"}'))
    assert.equal(store.getState().settings.newTableId, 'uuid')
  })

  it('does not write anything just because it started', () => {
    const { storage, writes } = countingStorage('{"newTableId":"uuid"}')
    connectSettings(makeStore(), storage)
    assert.equal(writes(), 0)
  })

  it('saves the settings the moment they change', () => {
    const { storage, peek } = countingStorage(null)
    const store = makeStore()
    connectSettings(store, storage)
    store.getState().setNewTableId('none')
    assert.equal(peek(), '{"newTableId":"none"}')
  })

  it('does not save when something else in the store changes', () => {
    const { storage, writes } = countingStorage(null)
    const store = makeStore()
    connectSettings(store, storage)
    store.getState().addTable()
    store.getState().select(null)
    assert.equal(writes(), 0)
  })

  it('stops saving once disconnected', () => {
    const { storage, writes } = countingStorage(null)
    const store = makeStore()
    const disconnect = connectSettings(store, storage)
    disconnect()
    store.getState().setNewTableId('none')
    assert.equal(writes(), 0)
  })

  it('keeps the default, without throwing, when the storage is blocked', () => {
    const store = makeStore()
    assert.doesNotThrow(() =>
      connectSettings(store, brokenStorage('SecurityError'))
    )
    assert.equal(store.getState().settings.newTableId, 'integer')
    assert.doesNotThrow(() => store.getState().setNewTableId('uuid'))
  })
})
