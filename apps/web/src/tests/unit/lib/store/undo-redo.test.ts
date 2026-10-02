import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { importSql } from '@forge/core'

import { GROUP_MS, MAX_STEPS } from '../../../../lib/history/history.ts'
import { createForgeStore } from '../../../../lib/store/forge-store.ts'

function setup() {
  let counter = 0
  let clock = 0
  const store = createForgeStore({
    newId: () => `id-${++counter}`,
    now: () => clock,
  })
  store.getState().setNewTableId('none')
  return {
    store,
    tick: (ms: number) => {
      clock += ms
    },
    tables: () => store.getState().schema.tables.map((t) => t.name),
  }
}

describe('undo and redo of the schema', () => {
  it('has nothing to undo on a new store, and undo then does nothing', () => {
    const { store } = setup()
    store.getState().undo()
    store.getState().redo()
    assert.equal(store.getState().schema.tables.length, 0)
  })

  it('undoes and redoes adding a table, with its position', () => {
    const { store, tables } = setup()
    const id = store.getState().addTable()
    const position = store.getState().view.nodes[id]
    store.getState().undo()
    assert.deepEqual(tables(), [])
    assert.equal(store.getState().view.nodes[id], undefined)
    store.getState().redo()
    assert.deepEqual(tables(), ['table_1'])
    assert.deepEqual(store.getState().view.nodes[id], position)
  })

  it('undoes removing a table with its relationships, indexes and position', () => {
    const { store, tick } = setup()
    const a = store.getState().addTable()
    tick(5000)
    const b = store.getState().addTable()
    const ca = store.getState().addColumn(a)
    const cb = store.getState().addColumn(b)
    assert.ok(ca && cb)
    store.getState().setPrimaryKey(a, [ca])
    store
      .getState()
      .connect({ tableId: b, columnId: cb }, { tableId: a, columnId: ca })
    store.getState().addIndex(b)
    const before = store.getState()
    const positionOfA = before.view.nodes[a]
    store.getState().removeTable(a)
    assert.equal(store.getState().schema.relationships.length, 0)
    store.getState().undo()
    assert.equal(store.getState().schema.relationships.length, 1)
    assert.equal(
      store.getState().schema.tables.find((t) => t.id === b)?.indexes?.length,
      1
    )
    assert.deepEqual(store.getState().view.nodes[a], positionOfA)
    assert.equal(store.getState().schema, before.schema)
  })

  it('a new edit after an undo empties the redo list, and the history goes on from there', () => {
    const { store, tables, tick } = setup()
    store.getState().addTable()
    tick(5000)
    store.getState().addTable()
    store.getState().undo()
    store.getState().addTable()
    store.getState().redo()
    assert.deepEqual(tables(), ['table_1', 'table_2'])
    store.getState().undo()
    store.getState().undo()
    assert.deepEqual(tables(), [])
  })
})

describe('grouping', () => {
  it('typing a name is one step; a pause makes a second; another field never joins', () => {
    const { store, tick } = setup()
    const id = store.getState().addTable()
    tick(5000)
    for (const name of ['a', 'ab', 'abc']) {
      store.getState().renameTable(id, name)
      tick(200)
    }
    tick(GROUP_MS)
    store.getState().renameTable(id, 'abcd')
    store.getState().setTableComment(id, 'x')
    store.getState().undo()
    assert.equal(store.getState().schema.tables[0]?.comment, undefined)
    assert.equal(store.getState().schema.tables[0]?.name, 'abcd')
    store.getState().undo()
    assert.equal(store.getState().schema.tables[0]?.name, 'abc')
    store.getState().undo()
    assert.equal(store.getState().schema.tables[0]?.name, 'table_1')
  })

  it('edits to different columns of one table are different steps', () => {
    const { store, tick } = setup()
    const t = store.getState().addTable()
    const c1 = store.getState().addColumn(t)
    const c2 = store.getState().addColumn(t)
    assert.ok(c1 && c2)
    tick(5000)
    store.getState().updateColumn(t, c1, { name: 'one' })
    store.getState().updateColumn(t, c2, { name: 'two' })
    store.getState().undo()
    assert.deepEqual(
      store.getState().schema.tables[0]?.columns.map((c) => c.name),
      ['one', 'column_2']
    )
  })

  it('moving a table in a drag is one step', () => {
    const { store, tick } = setup()
    const id = store.getState().addTable()
    tick(5000)
    const start = store.getState().view.nodes[id]
    for (let i = 1; i <= 20; i++) {
      store.getState().moveNode(id, { x: i * 10, y: i * 5 })
      tick(16)
    }
    store.getState().undo()
    assert.deepEqual(store.getState().view.nodes[id], start)
    assert.equal(store.getState().schema.tables.length, 1)
  })

  it('an edit that changes nothing is not a step', () => {
    const { store } = setup()
    store.getState().addTable()
    store.getState().undo()
    store.getState().redo()
    store.getState().removeTable('nope')
    store.getState().setPrimaryKey('nope', [])
    store.getState().undo()
    assert.equal(store.getState().schema.tables.length, 0)
  })
})

describe('what undo leaves alone, and what it clears', () => {
  it('keeps the viewport and the epoch', () => {
    const { store } = setup()
    store.getState().addTable()
    const viewport = { x: 7, y: 8, zoom: 2 }
    store.getState().setViewport(viewport)
    const epoch = store.getState().projectEpoch
    store.getState().undo()
    assert.deepEqual(store.getState().view.viewport, viewport)
    assert.equal(store.getState().projectEpoch, epoch)
  })

  it('clears a selection and a hover that point at a table that is gone', () => {
    const { store } = setup()
    const id = store.getState().addTable()
    store.getState().select(id)
    store.getState().hoverTable(id)
    store.getState().undo()
    assert.equal(store.getState().selection, null)
    assert.equal(store.getState().hoveredTable, null)
  })

  it('selecting, hovering, zooming and preferences are not steps', () => {
    const { store } = setup()
    const id = store.getState().addTable()
    store.getState().select(id)
    store.getState().hoverTable(id)
    store.getState().setViewport({ x: 1, y: 1, zoom: 1 })
    store.getState().setNewTableId('uuid')
    store.getState().clearSelection()
    store.getState().undo()
    assert.equal(store.getState().schema.tables.length, 0)
    assert.equal(store.getState().settings.newTableId, 'uuid')
  })
})

describe('project-level steps', () => {
  it('loading the example is a step: undo brings the project back and asks to fit', () => {
    const { store, tables } = setup()
    store.getState().addTable()
    const fit = store.getState().fitRequest
    store.getState().loadExample()
    assert.equal(store.getState().schema.tables.length, 7)
    const epoch = store.getState().projectEpoch
    store.getState().undo()
    assert.deepEqual(tables(), ['table_1'])
    assert.equal(store.getState().projectEpoch, epoch)
    assert.ok(store.getState().fitRequest > fit)
    store.getState().redo()
    assert.equal(store.getState().schema.tables.length, 7)
  })

  it('importing, replacing or adding, is a step', () => {
    const { store, tables } = setup()
    store.getState().addTable()
    const imported = importSql(
      'CREATE TABLE a (id int PRIMARY KEY); CREATE TABLE b (id int);',
      () => crypto.randomUUID()
    ).schema
    store.getState().importSchema(imported, 'add')
    assert.equal(store.getState().schema.tables.length, 3)
    store.getState().undo()
    assert.deepEqual(tables(), ['table_1'])
    store.getState().importSchema(imported, 'replace')
    assert.deepEqual(tables(), ['a', 'b'])
    store.getState().undo()
    assert.deepEqual(tables(), ['table_1'])
  })

  it('auto-arrange is a step that restores the positions', () => {
    const { store } = setup()
    store.getState().loadExample()
    const before = store.getState().view.nodes
    const id = store.getState().schema.tables[0]?.id as string
    store.getState().moveNode(id, { x: 999, y: 999 })
    store.getState().autoLayout()
    store.getState().undo()
    assert.deepEqual(store.getState().view.nodes[id], { x: 999, y: 999 })
    store.getState().undo()
    assert.deepEqual(store.getState().view.nodes, before)
  })
})

describe('the history is a document property', () => {
  it('starting a new project, and loading the saved one, reset it', () => {
    const { store } = setup()
    store.getState().addTable()
    store.getState().startNewProject()
    store.getState().undo()
    assert.equal(store.getState().schema.tables.length, 0)

    store.getState().addTable()
    store.getState().hydrate({ status: 'empty' } as never)
    store.getState().undo()
    assert.equal(store.getState().schema.tables.length, 0)
  })

  it('keeps at most MAX_STEPS steps', () => {
    const { store } = setup()
    for (let i = 0; i < MAX_STEPS + 5; i++) store.getState().addTable()
    for (let i = 0; i < MAX_STEPS + 5; i++) store.getState().undo()
    assert.equal(store.getState().schema.tables.length, 5)
  })
})
