import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CanvasActions } from '../../../../lib/canvas/forward-changes.ts'
import {
  forwardEdgeChanges,
  forwardNodeChanges,
} from '../../../../lib/canvas/forward-changes.ts'

function recorder(
  selection: string | null = null,
  relationship: string | null = null
) {
  const calls: unknown[][] = []
  let current = selection
  let currentRelationship = relationship
  const actions: CanvasActions = {
    moveNode: (id, position) => {
      calls.push(['moveNode', id, position])
    },
    select: (id) => {
      calls.push(['select', id])
      current = id
    },
    removeRelationship: (id) => {
      calls.push(['removeRelationship', id])
    },
    currentSelection: () => current,
    selectRelationship: (id) => {
      calls.push(['selectRelationship', id])
      currentRelationship = id
    },
    currentRelationshipSelection: () => currentRelationship,
  }
  return { actions, calls }
}

describe('forwardNodeChanges', () => {
  it('moves a node when its position changes', () => {
    const { actions, calls } = recorder()
    forwardNodeChanges(
      [{ type: 'position', id: 'a', position: { x: 1, y: 2 } }],
      actions
    )
    assert.deepEqual(calls, [['moveNode', 'a', { x: 1, y: 2 }]])
  })

  it('ignores a position change that carries no position', () => {
    const { actions, calls } = recorder()
    forwardNodeChanges([{ type: 'position', id: 'a' }], actions)
    assert.deepEqual(calls, [])
  })

  it('selects a node when React Flow reports it selected', () => {
    const { actions, calls } = recorder()
    forwardNodeChanges([{ type: 'select', id: 'a', selected: true }], actions)
    assert.deepEqual(calls, [['select', 'a']])
  })

  it('clears the selection when the selected node is deselected', () => {
    const { actions, calls } = recorder('a')
    forwardNodeChanges([{ type: 'select', id: 'a', selected: false }], actions)
    assert.deepEqual(calls, [['select', null]])
  })

  it('leaves the selection alone when another node is deselected', () => {
    const { actions, calls } = recorder('b')
    forwardNodeChanges([{ type: 'select', id: 'a', selected: false }], actions)
    assert.deepEqual(calls, [])
  })

  it('ends on the new selection when one node replaces another', () => {
    for (const order of [
      [
        { type: 'select', id: 'a', selected: false },
        { type: 'select', id: 'b', selected: true },
      ],
      [
        { type: 'select', id: 'b', selected: true },
        { type: 'select', id: 'a', selected: false },
      ],
    ]) {
      const { actions } = recorder('a')
      forwardNodeChanges(order, actions)
      assert.equal(actions.currentSelection(), 'b')
    }
  })

  it('never turns a node removal into an action', () => {
    const { actions, calls } = recorder('a')
    forwardNodeChanges([{ type: 'remove', id: 'a' }], actions)
    assert.deepEqual(calls, [])
  })

  it('ignores the changes the app does not own', () => {
    const { actions, calls } = recorder()
    forwardNodeChanges(
      [
        { type: 'dimensions', id: 'a' },
        { type: 'add' },
        { type: 'replace', id: 'a' },
      ],
      actions
    )
    assert.deepEqual(calls, [])
  })
})

describe('forwardEdgeChanges', () => {
  it('removes the relationship of a removed edge', () => {
    const { actions, calls } = recorder()
    forwardEdgeChanges([{ type: 'remove', id: 'r1' }], actions)
    assert.deepEqual(calls, [['removeRelationship', 'r1']])
  })

  it('selects a relationship when React Flow reports its edge selected', () => {
    const { actions, calls } = recorder()
    forwardEdgeChanges([{ type: 'select', id: 'r1', selected: true }], actions)
    assert.deepEqual(calls, [['selectRelationship', 'r1']])
  })

  it('clears the relationship selection when the selected edge is deselected', () => {
    const { actions, calls } = recorder(null, 'r1')
    forwardEdgeChanges([{ type: 'select', id: 'r1', selected: false }], actions)
    assert.deepEqual(calls, [['selectRelationship', null]])
  })

  it('leaves the selection alone when another edge is deselected', () => {
    const { actions, calls } = recorder(null, 'r2')
    forwardEdgeChanges([{ type: 'select', id: 'r1', selected: false }], actions)
    assert.deepEqual(calls, [])
  })

  it('ends on the new relationship when one edge replaces another', () => {
    for (const order of [
      [
        { type: 'select', id: 'r1', selected: false },
        { type: 'select', id: 'r2', selected: true },
      ],
      [
        { type: 'select', id: 'r2', selected: true },
        { type: 'select', id: 'r1', selected: false },
      ],
    ]) {
      const { actions } = recorder(null, 'r1')
      forwardEdgeChanges(order, actions)
      assert.equal(actions.currentRelationshipSelection(), 'r2')
    }
  })

  it('ignores the changes the app does not own', () => {
    const { actions, calls } = recorder()
    forwardEdgeChanges(
      [{ type: 'add' }, { type: 'replace', id: 'r1' }],
      actions
    )
    assert.deepEqual(calls, [])
  })
})
