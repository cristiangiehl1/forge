import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema, Table } from '@forge/core'

import { NODE_WIDTH, nodeRect } from '../../../../lib/geometry.ts'
import { placeAdded } from '../../../../lib/import/place-added.ts'
import { createView } from '../../../../lib/project-view.ts'

const table = (id: string, rows = 2): Table => ({
  id,
  name: id,
  columns: Array.from({ length: rows }, (_, i) => ({
    id: `${id}-${i}`,
    name: `c${i}`,
    type: { kind: 'integer' as const },
    nullable: true,
  })),
  primaryKey: [],
})
const schemaOf = (
  tables: Table[],
  relationships: Schema['relationships'] = []
): Schema => ({
  version: 1,
  tables,
  relationships,
})

describe('placeAdded', () => {
  it('starts at the default origin on an empty project', () => {
    const after = schemaOf([table('n1')])
    const positions = placeAdded(schemaOf([]), createView(), after, ['n1'])
    assert.deepEqual(positions, { n1: { x: 40, y: 40 } })
  })

  it('puts the added tables to the right of the existing ones, none overlapping', () => {
    const before = schemaOf([table('a'), table('b')])
    const view = {
      ...createView(),
      nodes: { a: { x: 40, y: 40 }, b: { x: 600, y: 300 } },
    }
    const after = schemaOf([...before.tables, table('n1'), table('n2')])
    const positions = placeAdded(before, view, after, ['n1', 'n2'])
    const rightEdge = 600 + NODE_WIDTH
    for (const id of ['n1', 'n2']) {
      assert.ok(
        (positions[id]?.x ?? 0) >= rightEdge + 100,
        `${id} at ${positions[id]?.x}`
      )
    }
    const boxes = Object.values(positions).map((p) => nodeRect(p, 2))
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const apart =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y
        assert.ok(apart)
      }
    }
  })

  it('uses where a table is drawn when it has no saved position', () => {
    const before = schemaOf([table('a'), table('b'), table('c'), table('d')])
    const after = schemaOf([...before.tables, table('n')])
    const positions = placeAdded(before, createView(), after, ['n'])
    // the grid puts the 4th table at x = 40, the 3rd column at 40 + 2 * 320
    assert.ok((positions.n?.x ?? 0) >= 40 + 2 * 320 + NODE_WIDTH + 100)
  })

  it('lays the added tables out by their relationships, parents to the left', () => {
    const before = schemaOf([table('a')])
    const after = schemaOf(
      [table('a'), table('parent'), table('child')],
      [
        {
          id: 'r',
          from: { tableId: 'child', columnId: 'child-0' },
          to: { tableId: 'parent', columnId: 'parent-0' },
        },
      ]
    )
    const positions = placeAdded(before, createView(), after, [
      'parent',
      'child',
    ])
    assert.ok((positions.parent?.x ?? 0) < (positions.child?.x ?? 0))
    assert.equal(positions.a, undefined)
  })

  it('snaps to multiples of 10', () => {
    const before = schemaOf([table('a')])
    const view = { ...createView(), nodes: { a: { x: 43, y: 47 } } }
    const positions = placeAdded(
      before,
      view,
      schemaOf([...before.tables, table('n')]),
      ['n']
    )
    assert.equal((positions.n?.x ?? 1) % 10, 0)
    assert.equal((positions.n?.y ?? 1) % 10, 0)
  })
})
