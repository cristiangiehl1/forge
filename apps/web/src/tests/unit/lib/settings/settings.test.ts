import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_SETTINGS,
  parseSettings,
} from '../../../../lib/settings/settings.ts'

describe('DEFAULT_SETTINGS', () => {
  it('starts new tables with an integer id', () => {
    assert.deepEqual(DEFAULT_SETTINGS, { newTableId: 'integer' })
  })
})

describe('parseSettings', () => {
  it('reads each of the three choices', () => {
    for (const newTableId of ['integer', 'uuid', 'none']) {
      assert.deepEqual(parseSettings({ newTableId }), { newTableId })
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
      newTableId: 'uuid',
    })
  })
})
