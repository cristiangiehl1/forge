import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createStabilizer,
  sameEdge,
  sameNode,
} from '../../../../lib/canvas/stabilize.ts'
import type { TableFlowNode } from '../../../../lib/canvas/to-flow.ts'

const node = (id: string, x = 0, y = 0, selected = false): TableFlowNode => ({
  id,
  type: 'table',
  position: { x, y },
  data: { tableId: id },
  selected,
})

describe('createStabilizer', () => {
  it('hands back the previous objects, and the previous array, when nothing changed', () => {
    const stabilize = createStabilizer(sameNode)
    const first = stabilize([node('a'), node('b')])
    const second = stabilize([node('a'), node('b')])
    assert.equal(second, first)
    assert.equal(second[0], first[0])
  })

  it('replaces only the object that changed', () => {
    const stabilize = createStabilizer(sameNode)
    const first = stabilize([node('a'), node('b')])
    const second = stabilize([node('a', 10, 20), node('b')])
    assert.notEqual(second, first)
    assert.notEqual(second[0], first[0])
    assert.equal(second[1], first[1])
    assert.deepEqual(second[0]?.position, { x: 10, y: 20 })
  })

  it('notices a selection change', () => {
    const stabilize = createStabilizer(sameNode)
    const first = stabilize([node('a'), node('b')])
    const second = stabilize([node('a'), node('b', 0, 0, true)])
    assert.equal(second[0], first[0])
    assert.notEqual(second[1], first[1])
  })

  it('follows additions, removals and a new order', () => {
    const stabilize = createStabilizer(sameNode)
    const first = stabilize([node('a'), node('b')])
    const added = stabilize([node('a'), node('b'), node('c')])
    assert.equal(added.length, 3)
    assert.equal(added[0], first[0])

    const removed = stabilize([node('c'), node('a')])
    assert.deepEqual(
      removed.map((n) => n.id),
      ['c', 'a']
    )
    assert.equal(removed[1], first[0])
  })

  it('starts from nothing without trouble', () => {
    assert.deepEqual(createStabilizer(sameNode)([]), [])
  })
})

describe('sameEdge', () => {
  const edge = {
    id: 'r',
    type: 'relationship',
    source: 'a',
    target: 'b',
    sourceHandle: 'x',
    targetHandle: 'y',
    selected: false,
  }

  it('compares everything that is drawn', () => {
    assert.equal(sameEdge(edge, { ...edge }), true)
    assert.equal(sameEdge(edge, { ...edge, selected: true }), false)
    assert.equal(sameEdge(edge, { ...edge, target: 'c' }), false)
    assert.equal(sameEdge(edge, { ...edge, sourceHandle: 'z' }), false)
  })
})
