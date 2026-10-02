import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema } from '@forge/core'
import { importSql } from '@forge/core'

import { createForgeStore } from '../../../../lib/store/forge-store.ts'

let counter = 0
const newId = () => `id-${++counter}`
function makeStore() {
  const store = createForgeStore({ newId })
  store.getState().setNewTableId('none')
  return store
}
const imported = (sql: string): Schema => importSql(sql, newId).schema

const SHOP = `
  CREATE TABLE users (id int PRIMARY KEY, name text);
  CREATE TABLE orders (id int PRIMARY KEY, user_id int REFERENCES users (id));`

describe('importSchema: replace', () => {
  it('replaces the project, lays the tables out, and clears the selection and the hover', () => {
    const store = makeStore()
    const old = store.getState().addTable()
    store.getState().select(old)
    store.getState().hoverTable(old)
    const epoch = store.getState().projectEpoch
    const fit = store.getState().fitRequest

    store.getState().importSchema(imported(SHOP), 'replace')
    const state = store.getState()
    assert.deepEqual(
      state.schema.tables.map((t) => t.name),
      ['users', 'orders']
    )
    assert.equal(state.schema.relationships.length, 1)
    assert.equal(state.selection, null)
    assert.equal(state.relationshipSelection, null)
    assert.equal(state.hoveredTable, null)
    assert.equal(state.projectEpoch, epoch + 1)
    assert.equal(state.fitRequest, fit + 1)
    const [users, orders] = state.schema.tables
    assert.ok(users && orders)
    assert.ok(
      (state.view.nodes[users.id]?.x ?? 0) <
        (state.view.nodes[orders.id]?.x ?? 0)
    )
    assert.equal(state.view.nodes[old], undefined)
  })

  it('also clears a "could not be read" notice and lets the project be saved again', () => {
    const store = makeStore()
    store.getState().hydrate({
      status: 'invalid',
      errors: [{ path: 'schema', message: 'bad' }],
    } as never)
    assert.equal(store.getState().persistence, 'blocked')
    store.getState().importSchema(imported(SHOP), 'replace')
    assert.equal(store.getState().persistence, 'ready')
    assert.equal(store.getState().notice, null)
  })
})

describe('importSchema: add', () => {
  it('keeps what is there, renames what collides, and places only the new tables to the right', () => {
    const store = makeStore()
    store.getState().importSchema(imported(SHOP), 'replace')
    const before = store.getState()
    const viewport = { x: 5, y: 6, zoom: 2 }
    store.getState().setViewport(viewport)
    const epoch = store.getState().projectEpoch
    const fit = store.getState().fitRequest
    const oldPositions = { ...store.getState().view.nodes }

    store
      .getState()
      .importSchema(
        imported(
          'CREATE TABLE users (id int PRIMARY KEY); CREATE TABLE items (id int);'
        ),
        'add'
      )
    const state = store.getState()
    assert.deepEqual(
      state.schema.tables.map((t) => t.name),
      ['users', 'orders', 'users_2', 'items']
    )
    assert.equal(
      state.schema.relationships.length,
      before.schema.relationships.length
    )
    for (const [id, position] of Object.entries(oldPositions)) {
      assert.deepEqual(state.view.nodes[id], position)
    }
    const rightEdge =
      Math.max(...Object.values(oldPositions).map((p) => p.x)) + 220
    for (const table of state.schema.tables.slice(2)) {
      assert.ok((state.view.nodes[table.id]?.x ?? 0) > rightEdge)
    }
    assert.deepEqual(state.view.viewport, viewport)
    assert.equal(state.projectEpoch, epoch)
    assert.equal(state.fitRequest, fit + 1)
    assert.equal(state.selection, null)
  })

  it('is a replace when the project has no tables and no types', () => {
    const store = makeStore()
    const epoch = store.getState().projectEpoch
    store.getState().importSchema(imported(SHOP), 'add')
    assert.equal(store.getState().schema.tables.length, 2)
    assert.equal(store.getState().projectEpoch, epoch + 1)
  })

  it('autosaves like any change: the schema in the store is the merged one', () => {
    const store = makeStore()
    store.getState().addTable()
    store.getState().importSchema(imported(SHOP), 'add')
    assert.equal(store.getState().schema.tables.length, 3)
  })
})
