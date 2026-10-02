import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema } from '@forge/core'

import {
  canRedo,
  canUndo,
  emptyHistory,
  GROUP_MS,
  MAX_STEPS,
  record,
  redoStep,
  type Snapshot,
  undoStep,
} from '../../../../lib/history/history.ts'

const schema = (n: number): Schema => ({
  version: 1,
  tables: [{ id: `t${n}`, name: `t${n}`, columns: [], primaryKey: [] }],
  relationships: [],
})
const snap = (n: number): Snapshot => ({
  schema: schema(n),
  nodes: { [`t${n}`]: { x: n, y: n } },
})
const name = (snapshot: Snapshot | undefined) =>
  snapshot?.schema.tables[0]?.name

describe('an empty history', () => {
  it('has nothing to undo or redo, and nothing to step to', () => {
    const h = emptyHistory()
    assert.equal(canUndo(h), false)
    assert.equal(canRedo(h), false)
    assert.equal(undoStep(h, snap(1)), null)
    assert.equal(redoStep(h, snap(1)), null)
  })
})

describe('record', () => {
  it('pushes the state before the edit and empties the redo list', () => {
    let h = record(emptyHistory(), snap(1), null, 0)
    assert.equal(canUndo(h), true)
    h = undoStep(h, snap(2))?.history ?? h
    assert.equal(canRedo(h), true)
    h = record(h, snap(2), null, 10)
    assert.equal(canRedo(h), false)
    assert.deepEqual(
      h.past.map((e) => name(e.snapshot)),
      ['t2']
    )
  })

  it('does not push for the same key within the group window, and keeps the first state', () => {
    let h = record(emptyHistory(), snap(1), 'rename:a', 0)
    h = record(h, snap(2), 'rename:a', 400)
    h = record(h, snap(3), 'rename:a', 400 + GROUP_MS - 1)
    assert.deepEqual(
      h.past.map((e) => name(e.snapshot)),
      ['t1']
    )
  })

  it('measures the window from the last edit, so steady typing stays one step', () => {
    let h = record(emptyHistory(), snap(1), 'k', 0)
    for (let i = 1; i <= 5; i++)
      h = record(h, snap(1 + i), 'k', i * (GROUP_MS - 100))
    assert.equal(h.past.length, 1)
  })

  it('starts a new step after a pause, for another key, or for no key', () => {
    let h = record(emptyHistory(), snap(1), 'k', 0)
    h = record(h, snap(2), 'k', GROUP_MS)
    h = record(h, snap(3), 'other', GROUP_MS + 10)
    h = record(h, snap(4), null, GROUP_MS + 20)
    h = record(h, snap(5), null, GROUP_MS + 30)
    assert.equal(h.past.length, 5)
  })

  it('keeps only the last MAX_STEPS steps', () => {
    let h = emptyHistory()
    for (let i = 0; i < MAX_STEPS + 20; i++) h = record(h, snap(i), null, i)
    assert.equal(h.past.length, MAX_STEPS)
    assert.equal(name(h.past[0]?.snapshot), `t20`)
  })

  it('remembers whether a step is a project-level one', () => {
    const h = record(emptyHistory(), snap(1), null, 0, true)
    assert.equal(h.past[0]?.fit, true)
    assert.equal(record(emptyHistory(), snap(1), null, 0).past[0]?.fit, false)
  })
})

describe('undoStep and redoStep', () => {
  it('walk back and forth over the same states', () => {
    let h = record(emptyHistory(), snap(1), null, 0)
    h = record(h, snap(2), null, 10)
    // the current state is snap(3)
    const back1 = undoStep(h, snap(3))
    assert.equal(name(back1?.entry.snapshot), 't2')
    const back2 = back1 && undoStep(back1.history, snap(2))
    assert.equal(name(back2?.entry.snapshot), 't1')
    assert.equal(back2 && undoStep(back2.history, snap(1)), null)

    const fwd1 = back2 && redoStep(back2.history, snap(1))
    assert.equal(name(fwd1?.entry.snapshot), 't2')
    const fwd2 = fwd1 && redoStep(fwd1.history, snap(2))
    assert.equal(name(fwd2?.entry.snapshot), 't3')
    assert.equal(fwd2 && redoStep(fwd2.history, snap(3)), null)
  })

  it('clears the group key, so the next edit is a new step', () => {
    let h = record(emptyHistory(), snap(1), 'k', 0)
    h = undoStep(h, snap(2))?.history ?? h
    assert.equal(h.lastKey, null)
  })

  it('carries the fit mark across undo and redo', () => {
    let h = record(emptyHistory(), snap(1), null, 0, true)
    const undone = undoStep(h, snap(2))
    assert.equal(undone?.entry.fit, true)
    h = undone?.history ?? h
    assert.equal(redoStep(h, snap(1))?.entry.fit, true)
  })
})
