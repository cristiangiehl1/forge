import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Table } from '@forge/core'

import { nextPrimaryKey } from '../../../lib/primary-key.ts'

const table: Table = {
  id: 't',
  name: 't',
  columns: [
    { id: 'a', name: 'a', type: { kind: 'text' }, nullable: true },
    { id: 'b', name: 'b', type: { kind: 'text' }, nullable: true },
    { id: 'c', name: 'c', type: { kind: 'text' }, nullable: true },
  ],
  primaryKey: ['c'],
}

describe('nextPrimaryKey', () => {
  it('adds a checked column and keeps the key in column order', () => {
    assert.deepEqual(nextPrimaryKey(table, 'a', true), ['a', 'c'])
  })

  it('removes an unchecked column', () => {
    assert.deepEqual(nextPrimaryKey(table, 'c', false), [])
  })

  it('leaves the key as it was when the state does not change', () => {
    assert.deepEqual(nextPrimaryKey(table, 'c', true), ['c'])
    assert.deepEqual(nextPrimaryKey(table, 'b', false), ['c'])
  })
})
