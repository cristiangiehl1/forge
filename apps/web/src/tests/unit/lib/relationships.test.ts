import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema } from '@forge/core'

import { relatedTables, relationshipsOf } from '../../../lib/relationships.ts'

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

describe('relatedTables', () => {
  it('includes the table a table references, and the tables that reference it', () => {
    assert.deepEqual([...relatedTables(schema, 'o')], ['u'])
    assert.deepEqual([...relatedTables(schema, 'u')], ['o'])
  })

  it('is empty for a table without relationships or an unknown one', () => {
    assert.equal(relatedTables(schema, 'x').size, 0)
    assert.equal(relatedTables(schema, 'nope').size, 0)
  })

  it('does not count a self-reference as related', () => {
    const selfRef: Schema = {
      ...schema,
      relationships: [
        {
          id: 'r2',
          from: { tableId: 'u', columnId: 'u1' },
          to: { tableId: 'u', columnId: 'u1' },
        },
      ],
    }
    assert.equal(relatedTables(selfRef, 'u').size, 0)
  })

  it('collapses several relationships to the same table', () => {
    const twice: Schema = {
      ...schema,
      relationships: [
        ...schema.relationships,
        {
          id: 'r3',
          from: { tableId: 'o', columnId: 'o1' },
          to: { tableId: 'u', columnId: 'u1' },
        },
        {
          id: 'r4',
          from: { tableId: 'u', columnId: 'u1' },
          to: { tableId: 'o', columnId: 'o1' },
        },
      ],
    }
    assert.deepEqual([...relatedTables(twice, 'o')], ['u'])
  })
})
