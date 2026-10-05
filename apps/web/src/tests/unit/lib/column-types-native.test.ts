import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  COLUMN_KINDS,
  choiceOf,
  defaultColumnType,
  formatColumnType,
  kindLabel,
} from '../../../lib/column-types.ts'

describe('number and native in the web helpers', () => {
  it('number is a kind with its own label and default', () => {
    assert.ok((COLUMN_KINDS as readonly string[]).includes('number'))
    assert.equal(kindLabel('number'), 'number (any precision)')
    assert.deepEqual(defaultColumnType('number'), { kind: 'number' })
  })

  it('formats number, a native by its text, and an array of either', () => {
    assert.equal(formatColumnType({ kind: 'number' }), 'number')
    assert.equal(
      formatColumnType({
        kind: 'native',
        dialect: 'oracle',
        text: 'NVARCHAR2(100)',
      }),
      'NVARCHAR2(100)'
    )
    assert.equal(
      formatColumnType({
        kind: 'array',
        of: { kind: 'native', dialect: 'postgres', text: 'inet' },
      }),
      'inet[]'
    )
  })

  it('a native column is its own choice in the type selector', () => {
    assert.equal(
      choiceOf({ kind: 'native', dialect: 'oracle', text: 'ROWID' }),
      'native'
    )
  })
})
