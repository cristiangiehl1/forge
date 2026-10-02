import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema, Table } from '@forge/core'

import { freeName, mergeImported } from '../../../../lib/import/merge-schema.ts'

const table = (
  id: string,
  name: string,
  extra: Partial<Table> = {}
): Table => ({
  id,
  name,
  columns: [
    { id: `${id}-c`, name: 'id', type: { kind: 'integer' }, nullable: false },
  ],
  primaryKey: [`${id}-c`],
  ...extra,
})
const index = (id: string, name: string, column: string) => ({
  id,
  name,
  columns: [column],
  unique: false,
  method: 'btree' as const,
})
const schemaOf = (tables: Table[], extra: Partial<Schema> = {}): Schema => ({
  version: 1,
  tables,
  relationships: [],
  ...extra,
})

describe('freeName', () => {
  it('keeps a free name, and numbers a taken one from 2, remembering each result', () => {
    const taken = new Set(['users'])
    assert.equal(freeName('orders', taken), 'orders')
    assert.equal(freeName('users', taken), 'users_2')
    assert.equal(freeName('users', taken), 'users_3')
    assert.deepEqual([...taken].sort(), [
      'orders',
      'users',
      'users_2',
      'users_3',
    ])
  })

  it('skips a numbered name that is also taken', () => {
    assert.equal(freeName('a', new Set(['a', 'a_2'])), 'a_3')
  })
})

describe('mergeImported', () => {
  it('appends the imported tables, relationships and types after the current ones', () => {
    const current = schemaOf([table('t1', 'users')])
    const imported = schemaOf([table('t2', 'orders')], {
      relationships: [
        {
          id: 'r',
          from: { tableId: 't2', columnId: 't2-c' },
          to: { tableId: 't2', columnId: 't2-c' },
        },
      ],
      types: [{ kind: 'enum', id: 'e', name: 'status', values: ['a'] }],
    })
    const merged = mergeImported(current, imported)
    assert.deepEqual(
      merged.schema.tables.map((t) => t.name),
      ['users', 'orders']
    )
    assert.deepEqual(merged.addedTableIds, ['t2'])
    assert.equal(merged.schema.relationships.length, 1)
    assert.deepEqual(
      merged.schema.types?.map((t) => t.name),
      ['status']
    )
    assert.deepEqual(merged.renamed, [])
  })

  it('renames a table, an index and a type that collide, and keeps every id and every relationship', () => {
    const current = schemaOf(
      [table('t1', 'users', { indexes: [index('i1', 'idx_users', 't1-c')] })],
      { types: [{ kind: 'enum', id: 'e1', name: 'status', values: ['a'] }] }
    )
    const imported = schemaOf(
      [
        table('t2', 'users', { indexes: [index('i2', 'idx_users', 't2-c')] }),
        table('t3', 'orders'),
      ],
      {
        relationships: [
          {
            id: 'r',
            from: { tableId: 't3', columnId: 't3-c' },
            to: { tableId: 't2', columnId: 't2-c' },
          },
        ],
        types: [{ kind: 'enum', id: 'e2', name: 'status', values: ['b'] }],
      }
    )
    const merged = mergeImported(current, imported)
    assert.deepEqual(
      merged.schema.tables.map((t) => [t.id, t.name]),
      [
        ['t1', 'users'],
        ['t2', 'users_2'],
        ['t3', 'orders'],
      ]
    )
    assert.deepEqual(
      merged.schema.tables[1]?.indexes?.map((i) => [i.id, i.name]),
      [['i2', 'idx_users_2']]
    )
    assert.deepEqual(
      merged.schema.types?.map((t) => [t.id, t.name]),
      [
        ['e1', 'status'],
        ['e2', 'status_2'],
      ]
    )
    assert.deepEqual(merged.schema.relationships[0]?.to, {
      tableId: 't2',
      columnId: 't2-c',
    })
    assert.deepEqual(merged.renamed, [
      { kind: 'table', from: 'users', to: 'users_2' },
      { kind: 'index', from: 'idx_users', to: 'idx_users_2' },
      { kind: 'type', from: 'status', to: 'status_2' },
    ])
  })

  it('does not change the schemas it was given', () => {
    const current = schemaOf([table('t1', 'users')])
    const imported = schemaOf([table('t2', 'users')])
    const before = JSON.stringify([current, imported])
    mergeImported(current, imported)
    assert.equal(JSON.stringify([current, imported]), before)
  })

  it('adds no types key when neither side has types, and works on an empty project', () => {
    const merged = mergeImported(schemaOf([]), schemaOf([table('t', 'a')]))
    assert.equal('types' in merged.schema, false)
    assert.equal(merged.schema.tables.length, 1)
  })
})
