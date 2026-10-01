import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { addTable, createProject, createSchema } from '@forge/core'

import { createView, nextNodePosition } from '../../../../lib/project-view.ts'
import { createForgeStore } from '../../../../lib/store/forge-store.ts'

function makeStore() {
  let counter = 0
  return createForgeStore({ newId: () => `id-${++counter}` })
}

type TestStore = ReturnType<typeof makeStore>

function must<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined, 'expected a value')
  return value
}

/** users(id uuid, primary key) and orders(user_id uuid). */
function withUsersAndOrders(store: TestStore) {
  const state = () => store.getState()
  const users = state().addTable()
  const usersId = must(state().addColumn(users))
  state().updateColumn(users, usersId, { name: 'id', type: { kind: 'uuid' } })
  state().setPrimaryKey(users, [usersId])
  const orders = state().addTable()
  const ordersUser = must(state().addColumn(orders))
  state().updateColumn(orders, ordersUser, {
    name: 'user_id',
    type: { kind: 'uuid' },
  })
  return { users, usersId, orders, ordersUser }
}

describe('initial state', () => {
  it('starts empty, not hydrated, ready to persist', () => {
    const state = makeStore().getState()
    assert.deepEqual(state.schema, createSchema())
    assert.deepEqual(state.view, createView())
    assert.equal(state.selection, null)
    assert.equal(state.hydrated, false)
    assert.equal(state.persistence, 'ready')
    assert.equal(state.notice, null)
  })
})

describe('hydrate', () => {
  it('starts an empty project when nothing was stored', () => {
    const store = makeStore()
    store.getState().hydrate({ status: 'empty' })
    assert.equal(store.getState().hydrated, true)
    assert.equal(store.getState().persistence, 'ready')
    assert.deepEqual(store.getState().schema, createSchema())
  })

  it('restores the schema and the view of a loaded project', () => {
    const store = makeStore()
    const schema = addTable(createSchema(), { id: 't1', name: 'users' })
    const view = {
      nodes: { t1: { x: 5, y: 6 } },
      viewport: { x: 1, y: 2, zoom: 3 },
    }
    store.getState().hydrate({
      status: 'loaded',
      project: createProject(schema, view),
    })
    const state = store.getState()
    assert.deepEqual(state.schema, schema)
    assert.deepEqual(state.view, view)
    assert.equal(state.persistence, 'ready')
    assert.equal(state.notice, null)
  })

  it('uses a default view when the stored view is malformed', () => {
    const store = makeStore()
    store.getState().hydrate({
      status: 'loaded',
      project: createProject(createSchema(), 'garbage'),
    })
    assert.deepEqual(store.getState().view, createView())
  })

  it('blocks persistence when the stored project is invalid', () => {
    const store = makeStore()
    const errors = [{ path: 'schema', message: 'broken' }]
    store.getState().hydrate({ status: 'invalid', errors })
    const state = store.getState()
    assert.equal(state.hydrated, true)
    assert.equal(state.persistence, 'blocked')
    assert.deepEqual(state.notice, { kind: 'invalid', errors })
    assert.deepEqual(state.schema, createSchema())
  })

  it('keeps persistence on, with a notice, when storage is unavailable', () => {
    const store = makeStore()
    store.getState().hydrate({ status: 'unavailable', message: 'blocked' })
    assert.equal(store.getState().persistence, 'ready')
    assert.deepEqual(store.getState().notice, {
      kind: 'unavailable',
      message: 'blocked',
    })
  })

  it('startNewProject clears the block and the notice', () => {
    const store = makeStore()
    store.getState().hydrate({
      status: 'invalid',
      errors: [{ path: '', message: 'broken' }],
    })
    store.getState().startNewProject()
    assert.equal(store.getState().persistence, 'ready')
    assert.equal(store.getState().notice, null)
  })
})

describe('tables', () => {
  it('addTable names, places and selects the new table', () => {
    const store = makeStore()
    const first = store.getState().addTable()
    const second = store.getState().addTable()
    const state = store.getState()
    assert.deepEqual(
      state.schema.tables.map((table) => table.name),
      ['table_1', 'table_2']
    )
    assert.deepEqual(state.view.nodes[first], nextNodePosition(0))
    assert.deepEqual(state.view.nodes[second], nextNodePosition(1))
    assert.equal(state.selection, second)
  })

  it('addTable skips names that are already taken', () => {
    const store = makeStore()
    const first = store.getState().addTable()
    store.getState().renameTable(first, 'table_2')
    store.getState().addTable()
    assert.equal(store.getState().schema.tables[1]?.name, 'table_3')
  })

  it('renameTable keeps the other tables by reference', () => {
    const store = makeStore()
    const first = store.getState().addTable()
    store.getState().addTable()
    const before = store.getState().schema.tables[1]
    store.getState().renameTable(first, 'people')
    assert.equal(store.getState().schema.tables[0]?.name, 'people')
    assert.equal(store.getState().schema.tables[1], before)
  })

  it('removeTable drops the table, its position and its relationships', () => {
    const store = makeStore()
    const { users, usersId, orders, ordersUser } = withUsersAndOrders(store)
    store
      .getState()
      .connect(
        { tableId: orders, columnId: ordersUser },
        { tableId: users, columnId: usersId }
      )
    store.getState().removeTable(users)
    const state = store.getState()
    assert.equal(state.schema.tables.length, 1)
    assert.equal(state.schema.relationships.length, 0)
    assert.equal(state.view.nodes[users], undefined)
  })

  it('removeTable clears the selection only when it was the selected table', () => {
    const store = makeStore()
    const first = store.getState().addTable()
    const second = store.getState().addTable()
    store.getState().removeTable(first)
    assert.equal(store.getState().selection, second)
    store.getState().removeTable(second)
    assert.equal(store.getState().selection, null)
  })
})

describe('columns', () => {
  it('addColumn adds a nullable text column named column_N', () => {
    const store = makeStore()
    const table = store.getState().addTable()
    const columnId = must(store.getState().addColumn(table))
    assert.deepEqual(store.getState().schema.tables[0]?.columns, [
      {
        id: columnId,
        name: 'column_1',
        type: { kind: 'text' },
        nullable: true,
      },
    ])
    store.getState().addColumn(table)
    assert.equal(
      store.getState().schema.tables[0]?.columns[1]?.name,
      'column_2'
    )
  })

  it('addColumn returns null and changes nothing for an unknown table', () => {
    const store = makeStore()
    const before = store.getState().schema
    assert.equal(store.getState().addColumn('nope'), null)
    assert.equal(store.getState().schema, before)
  })

  it('updateColumn, setPrimaryKey and removeColumn go through the core', () => {
    const store = makeStore()
    const table = store.getState().addTable()
    const columnId = must(store.getState().addColumn(table))
    store
      .getState()
      .updateColumn(table, columnId, { name: 'id', nullable: false })
    store.getState().setPrimaryKey(table, [columnId])
    assert.equal(store.getState().schema.tables[0]?.columns[0]?.name, 'id')
    assert.deepEqual(store.getState().schema.tables[0]?.primaryKey, [columnId])
    store.getState().removeColumn(table, columnId)
    assert.deepEqual(store.getState().schema.tables[0]?.columns, [])
    assert.deepEqual(store.getState().schema.tables[0]?.primaryKey, [])
  })
})

describe('relationships', () => {
  it('connect adds an allowed relationship and returns null', () => {
    const store = makeStore()
    const { users, usersId, orders, ordersUser } = withUsersAndOrders(store)
    const issue = store
      .getState()
      .connect(
        { tableId: orders, columnId: ordersUser },
        { tableId: users, columnId: usersId }
      )
    assert.equal(issue, null)
    assert.equal(store.getState().schema.relationships.length, 1)
  })

  it('connect returns the issue and changes nothing for a forbidden one', () => {
    const store = makeStore()
    const { users, usersId, orders, ordersUser } = withUsersAndOrders(store)
    store
      .getState()
      .updateColumn(orders, ordersUser, { type: { kind: 'text' } })
    const before = store.getState().schema
    const issue = store
      .getState()
      .connect(
        { tableId: orders, columnId: ordersUser },
        { tableId: users, columnId: usersId }
      )
    assert.equal(issue?.code, 'relationship-type-mismatch')
    assert.equal(store.getState().schema, before)
  })

  it('removeRelationship removes it by id', () => {
    const store = makeStore()
    const { users, usersId, orders, ordersUser } = withUsersAndOrders(store)
    store
      .getState()
      .connect(
        { tableId: orders, columnId: ordersUser },
        { tableId: users, columnId: usersId }
      )
    const relationshipId = must(store.getState().schema.relationships[0]?.id)
    store.getState().removeRelationship(relationshipId)
    assert.equal(store.getState().schema.relationships.length, 0)
  })
})

describe('view and selection', () => {
  it('moveNode updates one position and leaves the schema untouched', () => {
    const store = makeStore()
    const table = store.getState().addTable()
    const schema = store.getState().schema
    store.getState().moveNode(table, { x: 100, y: 200 })
    assert.deepEqual(store.getState().view.nodes[table], { x: 100, y: 200 })
    assert.equal(store.getState().schema, schema)
  })

  it('setViewport and select update their own slices', () => {
    const store = makeStore()
    const table = store.getState().addTable()
    store.getState().setViewport({ x: 1, y: 2, zoom: 1.5 })
    store.getState().select(null)
    assert.deepEqual(store.getState().view.viewport, { x: 1, y: 2, zoom: 1.5 })
    assert.equal(store.getState().selection, null)
    store.getState().select(table)
    assert.equal(store.getState().selection, table)
  })
})

describe('relationship selection', () => {
  function connected() {
    const store = makeStore()
    const { users, usersId, orders, ordersUser } = withUsersAndOrders(store)
    store
      .getState()
      .connect(
        { tableId: orders, columnId: ordersUser },
        { tableId: users, columnId: usersId }
      )
    const relationshipId = must(store.getState().schema.relationships[0]?.id)
    return { store, users, orders, relationshipId }
  }

  it('starts without a selected relationship', () => {
    assert.equal(makeStore().getState().relationshipSelection, null)
  })

  it('selecting a relationship clears the table selection', () => {
    const { store, relationshipId } = connected()
    assert.notEqual(store.getState().selection, null)
    store.getState().selectRelationship(relationshipId)
    assert.equal(store.getState().relationshipSelection, relationshipId)
    assert.equal(store.getState().selection, null)
  })

  it('selecting a table clears the relationship selection', () => {
    const { store, users, relationshipId } = connected()
    store.getState().selectRelationship(relationshipId)
    store.getState().select(users)
    assert.equal(store.getState().selection, users)
    assert.equal(store.getState().relationshipSelection, null)
  })

  it('deselecting the table does not touch the relationship selection', () => {
    const { store, relationshipId } = connected()
    store.getState().selectRelationship(relationshipId)
    store.getState().select(null)
    assert.equal(store.getState().relationshipSelection, relationshipId)
  })

  it('selectRelationship(null) clears only the relationship selection', () => {
    const { store, users, relationshipId } = connected()
    store.getState().select(users)
    store.getState().selectRelationship(relationshipId)
    store.getState().selectRelationship(null)
    assert.equal(store.getState().relationshipSelection, null)
  })

  it('clearSelection clears both selections', () => {
    const { store, users, relationshipId } = connected()
    store.getState().select(users)
    store.getState().clearSelection()
    store.getState().selectRelationship(relationshipId)
    store.getState().clearSelection()
    assert.equal(store.getState().selection, null)
    assert.equal(store.getState().relationshipSelection, null)
  })

  it('removing the selected relationship clears the selection', () => {
    const { store, relationshipId } = connected()
    store.getState().selectRelationship(relationshipId)
    store.getState().removeRelationship(relationshipId)
    assert.equal(store.getState().schema.relationships.length, 0)
    assert.equal(store.getState().relationshipSelection, null)
  })

  it('removing another relationship keeps the selection', () => {
    const { store, relationshipId } = connected()
    store.getState().selectRelationship(relationshipId)
    store.getState().removeRelationship('does-not-exist')
    assert.equal(store.getState().relationshipSelection, relationshipId)
  })

  it('removing a table or column that takes the relationship with it clears the selection', () => {
    const viaTable = connected()
    viaTable.store.getState().selectRelationship(viaTable.relationshipId)
    viaTable.store.getState().removeTable(viaTable.users)
    assert.equal(viaTable.store.getState().relationshipSelection, null)

    const viaColumn = connected()
    viaColumn.store.getState().selectRelationship(viaColumn.relationshipId)
    const column = must(
      viaColumn.store.getState().schema.relationships[0]?.from.columnId
    )
    viaColumn.store.getState().removeColumn(viaColumn.orders, column)
    assert.equal(viaColumn.store.getState().relationshipSelection, null)
  })

  it('a fresh project has no selected relationship', () => {
    const { store, relationshipId } = connected()
    store.getState().selectRelationship(relationshipId)
    store.getState().startNewProject()
    assert.equal(store.getState().relationshipSelection, null)

    store.getState().selectRelationship('x')
    store.getState().hydrate({ status: 'empty' })
    assert.equal(store.getState().relationshipSelection, null)
  })
})
