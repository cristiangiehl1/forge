import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DEFAULT_SETTINGS } from '../../../lib/settings/settings.ts'
import {
  loadSettings,
  saveSettings,
} from '../../../lib/settings/settings-storage.ts'
import {
  brokenStorage,
  memoryStorage,
  quotaStorage,
} from '../../helpers/memory-storage.ts'

describe('loadSettings', () => {
  it('returns the default when nothing was saved', () => {
    assert.deepEqual(loadSettings(memoryStorage()), DEFAULT_SETTINGS)
  })

  it('returns what saveSettings stored', () => {
    const storage = memoryStorage()
    saveSettings(storage, { ...DEFAULT_SETTINGS, newTableId: 'uuid' })
    assert.deepEqual(loadSettings(storage), {
      ...DEFAULT_SETTINGS,
      newTableId: 'uuid',
    })
  })

  it('returns the default for text that is not JSON', () => {
    assert.deepEqual(loadSettings(memoryStorage('{ nope')), DEFAULT_SETTINGS)
  })

  it('returns the default for JSON with an unknown choice', () => {
    assert.deepEqual(
      loadSettings(memoryStorage('{"newTableId":"bigint"}')),
      DEFAULT_SETTINGS
    )
  })

  it('returns the default, without throwing, when storage cannot be read', () => {
    assert.deepEqual(
      loadSettings(brokenStorage('SecurityError')),
      DEFAULT_SETTINGS
    )
  })
})

describe('saveSettings', () => {
  it('writes the settings as JSON', () => {
    const storage = memoryStorage()
    saveSettings(storage, { ...DEFAULT_SETTINGS, newTableId: 'none' })
    assert.equal(
      storage.peek(),
      '{"newTableId":"none","newTableTimestamps":false}'
    )
  })

  it('does not throw when the write fails', () => {
    assert.doesNotThrow(() =>
      saveSettings(quotaStorage(null, 'QuotaExceededError'), {
        ...DEFAULT_SETTINGS,
        newTableId: 'uuid',
      })
    )
    assert.doesNotThrow(() =>
      saveSettings(brokenStorage('SecurityError'), {
        ...DEFAULT_SETTINGS,
        newTableId: 'uuid',
      })
    )
  })
})
