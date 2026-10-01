import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema } from '@forge/core'

import { relationshipsOf } from '../../../lib/relationships.ts'

const schema: Schema = {
  version: 1,
  tables: [
    {
      id: 'u',
      name: 'users',
      columns: [
        { id: 'u1', name: 'id', type: { kind: 'uuid' }, nullable: false },
      ],
      primaryKey: ['u1'],
    },
    {
      id: 'o',
      name: 'orders',
      columns: [
        { id: 'o1', name: 'user_id', type: { kind: 'uuid' }, nullable: true },
      ],
      primaryKey: [],
    },
    { id: 'x', name: 'unrelated', columns: [], primaryKey: [] },
  ],
  relationships: [
    {
      id: 'r1',
      from: { tableId: 'o', columnId: 'o1' },
      to: { tableId: 'u', columnId: 'u1' },
    },
  ],
}

describe('relationshipsOf', () => {
  it('lists a relationship from the table where it starts', () => {
    assert.deepEqual(relationshipsOf(schema, 'o'), [
      { id: 'r1', label: 'orders.user_id → users.id' },
    ])
  })

  it('lists the same relationship from the table where it ends', () => {
    assert.deepEqual(relationshipsOf(schema, 'u'), [
      { id: 'r1', label: 'orders.user_id → users.id' },
    ])
  })

  it('returns nothing for a table without relationships or an unknown one', () => {
    assert.deepEqual(relationshipsOf(schema, 'x'), [])
    assert.deepEqual(relationshipsOf(schema, 'nope'), [])
  })

  it('shows blank names as (unnamed)', () => {
    const blank: Schema = {
      ...schema,
      tables: schema.tables.map((table) =>
        table.id === 'o'
          ? {
              ...table,
              name: ' ',
              columns: table.columns.map((column) => ({ ...column, name: '' })),
            }
          : table
      ),
    }
    assert.deepEqual(relationshipsOf(blank, 'o'), [
      { id: 'r1', label: '(unnamed).(unnamed) → users.id' },
    ])
  })
})
