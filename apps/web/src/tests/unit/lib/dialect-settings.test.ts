import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { dialectSettings } from '../../../lib/dialect-settings.ts'

describe('dialectSettings', () => {
  it('is empty for PostgreSQL with no options, so an untouched project is saved as it was', () => {
    assert.deepEqual(dialectSettings('postgres', {}), {})
  })

  it('carries the dialect once it is chosen, and the options once they are set', () => {
    assert.deepEqual(dialectSettings('oracle', {}), {
      dialect: 'oracle',
      options: {},
    })
    assert.deepEqual(dialectSettings('postgres', { uuid: 'varchar36' }), {
      dialect: 'postgres',
      options: { uuid: 'varchar36' },
    })
  })
})
