import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createForgeStore } from '../../../../lib/store/forge-store.ts'

function makeStore() {
  let counter = 0
  const store = createForgeStore({ newId: () => `id-${++counter}` })
  store.getState().setNewTableId('none')
  return store
}

function withColumns() {
  const store = makeStore()
  const tableId = store.getState().addTable()
  const columnId = store.getState().addColumn(tableId)
  assert.ok(columnId)
  return { store, tableId, columnId }
}

describe('table comment', () => {
  it('sets and clears it', () => {
    const { store, tableId } = withColumns()
    store.getState().setTableComment(tableId, 'People')
    assert.equal(store.getState().schema.tables[0]?.comment, 'People')
    store.getState().setTableComment(tableId, '')
    assert.equal('comment' in (store.getState().schema.tables[0] ?? {}), false)
  })
})

describe('indexes', () => {
  it('adds an index on the first column, named after the table and the column', () => {
    const { store, tableId, columnId } = withColumns()
    const id = store.getState().addIndex(tableId)
    assert.ok(id)
    assert.deepEqual(store.getState().schema.tables[0]?.indexes, [
      {
        id,
        name: 'idx_table_1_column_1',
        columns: [columnId],
        unique: false,
        method: 'btree',
      },
    ])
  })

  it('does not add an index to a table with no columns', () => {
    const store = makeStore()
    const tableId = store.getState().addTable()
    assert.equal(store.getState().addIndex(tableId), null)
    assert.equal(store.getState().schema.tables[0]?.indexes, undefined)
  })

  it('gives a second index a name that is free', () => {
    const { store, tableId } = withColumns()
    store.getState().addIndex(tableId)
    store.getState().addIndex(tableId)
    const names = store
      .getState()
      .schema.tables[0]?.indexes?.map((index) => index.name)
    assert.deepEqual(names, ['idx_table_1_column_1', 'idx_table_1_column_1_2'])
  })

  it('updates and removes an index', () => {
    const { store, tableId } = withColumns()
    const id = store.getState().addIndex(tableId)
    assert.ok(id)
    store.getState().updateIndex(tableId, id, { unique: true, name: 'uq_x' })
    assert.equal(store.getState().schema.tables[0]?.indexes?.[0]?.unique, true)
    assert.equal(store.getState().schema.tables[0]?.indexes?.[0]?.name, 'uq_x')
    store.getState().removeIndex(tableId, id)
    assert.deepEqual(store.getState().schema.tables[0]?.indexes, [])
  })
})

describe('user types', () => {
  it('adds an enum with one value and a domain on text, with free names', () => {
    const store = makeStore()
    const enumId = store.getState().addType('enum')
    const domainId = store.getState().addType('domain')
    assert.deepEqual(store.getState().schema.types, [
      { kind: 'enum', id: enumId, name: 'type_1', values: ['value_1'] },
      { kind: 'domain', id: domainId, name: 'type_2', base: { kind: 'text' } },
    ])
  })

  it('updates a type', () => {
    const store = makeStore()
    const id = store.getState().addType('enum')
    store
      .getState()
      .updateType({ kind: 'enum', id, name: 'mood', values: ['a', 'b'] })
    assert.deepEqual(store.getState().schema.types?.[0], {
      kind: 'enum',
      id,
      name: 'mood',
      values: ['a', 'b'],
    })
  })

  it('removes a type nobody uses, and says what uses one that is used', () => {
    const { store, tableId, columnId } = withColumns()
    const typeId = store.getState().addType('enum')
    store
      .getState()
      .updateColumn(tableId, columnId, { type: { kind: 'user', typeId } })

    const blocked = store.getState().removeType(typeId)
    assert.deepEqual(blocked, [{ kind: 'column', tableId, columnId }])
    assert.equal(store.getState().schema.types?.length, 1)

    store.getState().updateColumn(tableId, columnId, { type: { kind: 'text' } })
    assert.deepEqual(store.getState().removeType(typeId), [])
    assert.deepEqual(store.getState().schema.types, [])
  })
})
