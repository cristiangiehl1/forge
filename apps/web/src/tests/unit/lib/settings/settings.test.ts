import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_SETTINGS,
  parseSettings,
} from '../../../../lib/settings/settings.ts'

describe('DEFAULT_SETTINGS', () => {
  it('starts new tables with an integer id and no timestamp columns', () => {
    assert.deepEqual(DEFAULT_SETTINGS, {
      newTableId: 'integer',
      newTableTimestamps: false,
    })
  })
})

describe('parseSettings', () => {
  it('reads each of the three choices', () => {
    for (const newTableId of ['integer', 'uuid', 'none']) {
      assert.deepEqual(parseSettings({ newTableId }), {
        ...DEFAULT_SETTINGS,
        newTableId,
      })
    }
  })

  it('falls back to the default for anything it does not understand', () => {
    for (const input of [
      null,
      undefined,
      42,
      'integer',
      [],
      {},
      { newTableId: 'bigint' },
      { newTableId: 7 },
      { newTableId: null },
    ]) {
      assert.deepEqual(parseSettings(input), DEFAULT_SETTINGS)
    }
  })

  it('ignores fields it does not know', () => {
    assert.deepEqual(parseSettings({ newTableId: 'uuid', theme: 'dark' }), {
      ...DEFAULT_SETTINGS,
      newTableId: 'uuid',
    })
  })

  it('reads the timestamps preference on its own, and a saved id choice without it keeps working', () => {
    assert.deepEqual(parseSettings({ newTableTimestamps: true }), {
      ...DEFAULT_SETTINGS,
      newTableTimestamps: true,
    })
    assert.deepEqual(parseSettings({ newTableId: 'uuid' }), {
      newTableId: 'uuid',
      newTableTimestamps: false,
    })
  })

  it('ignores a timestamps preference that is not a boolean, keeping a valid id choice', () => {
    assert.deepEqual(
      parseSettings({ newTableId: 'none', newTableTimestamps: 'yes' }),
      { newTableId: 'none', newTableTimestamps: false }
    )
  })
})
