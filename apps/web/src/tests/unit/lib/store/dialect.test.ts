import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createProject, createSchema } from '@forge/core'

import { createForgeStore } from '../../../../lib/store/forge-store.ts'

function makeStore() {
  let counter = 0
  return createForgeStore({ newId: () => `id-${++counter}` })
}

describe('the dialect in the store', () => {
  it('starts as PostgreSQL with no options', () => {
    const { dialect, dialectOptions } = makeStore().getState()
    assert.equal(dialect, 'postgres')
    assert.deepEqual(dialectOptions, {})
  })

  it('is set and its options are set', () => {
    const store = makeStore()
    store.getState().setDialect('oracle')
    store.getState().setDialectOptions({ uuid: 'varchar36' })
    assert.equal(store.getState().dialect, 'oracle')
    assert.deepEqual(store.getState().dialectOptions, { uuid: 'varchar36' })
  })

  it('is taken from a loaded project, and defaults for one saved without it', () => {
    const store = makeStore()
    store.getState().hydrate({
      status: 'loaded',
      project: createProject(createSchema(), null, {
        dialect: 'oracle',
        options: { uuid: 'raw16' },
      }),
    } as never)
    assert.equal(store.getState().dialect, 'oracle')
    assert.deepEqual(store.getState().dialectOptions, { uuid: 'raw16' })

    const other = makeStore()
    other.getState().setDialect('oracle')
    other.getState().hydrate({
      status: 'loaded',
      project: createProject(createSchema(), null),
    } as never)
    assert.equal(other.getState().dialect, 'postgres')
    assert.deepEqual(other.getState().dialectOptions, {})
  })

  it('is reset by a new project, and kept by loading the example and by an import', () => {
    const store = makeStore()
    store.getState().setDialect('oracle')
    store.getState().loadExample()
    assert.equal(store.getState().dialect, 'oracle')
    store.getState().importSchema(createSchema(), 'replace')
    assert.equal(store.getState().dialect, 'oracle')
    store.getState().startNewProject()
    assert.equal(store.getState().dialect, 'postgres')
  })

  it('is made Oracle by loading the recruitment example', () => {
    const store = makeStore()
    assert.equal(store.getState().dialect, 'postgres')
    store.getState().loadExample('recruitment')
    assert.equal(store.getState().dialect, 'oracle')
    assert.ok(store.getState().schema.tables.length > 40)
  })

  it('is not a step of the undo history', () => {
    const store = makeStore()
    store.getState().setDialect('oracle')
    store.getState().setDialectOptions({ uuid: 'varchar36' })
    assert.equal(store.getState().history.past.length, 0)
    store.getState().addTable()
    store.getState().undo()
    assert.equal(store.getState().dialect, 'oracle')
  })
})
