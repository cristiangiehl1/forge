import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema } from '@forge/core'

import { createShopExample } from '../../../../lib/example/shop-example.ts'
import type { Point, Rect } from '../../../../lib/geometry.ts'
import { nodeRect } from '../../../../lib/geometry.ts'
import { layoutTables } from '../../../../lib/layout/layout-tables.ts'
import { routeRelationships } from '../../../../lib/routing/route-relationships.ts'

function schemaOf(names: string[], references: [string, string][]): Schema {
  return {
    version: 1,
    tables: names.map((name) => ({
      id: name,
      name,
      columns: [0, 1, 2].map((index) => ({
        id: `${name}.${index}`,
        name: index === 0 ? 'id' : `c${index}`,
        type: { kind: 'integer' },
        nullable: true,
      })),
      primaryKey: [`${name}.0`],
    })),
    relationships: references.map(([child, parent], index) => ({
      id: `r${index}`,
      from: { tableId: child, columnId: `${child}.1` },
      to: { tableId: parent, columnId: `${parent}.0` },
    })),
  }
}

function crosses(a: Point, b: Point, r: Rect): boolean {
  if (a.y === b.y) {
    return (
      a.y > r.y &&
      a.y < r.y + r.height &&
      Math.min(a.x, b.x) < r.x + r.width &&
      Math.max(a.x, b.x) > r.x
    )
  }
  return (
    a.x > r.x &&
    a.x < r.x + r.width &&
    Math.min(a.y, b.y) < r.y + r.height &&
    Math.max(a.y, b.y) > r.y
  )
}

function rectsOf(schema: Schema, positions: Record<string, Point>): Rect[] {
  return schema.tables.map((t) =>
    nodeRect(positions[t.id] as Point, t.columns.length)
  )
}

describe('routeRelationships', () => {
  it('routes every relationship', () => {
    const schema = schemaOf(
      ['a', 'b', 'c'],
      [
        ['b', 'a'],
        ['c', 'a'],
      ]
    )
    const routes = routeRelationships(schema, layoutTables(schema))
    assert.deepEqual([...routes.keys()].sort(), ['r0', 'r1'])
  })

  it('leaves a child by the side that faces its parent', () => {
    const schema = schemaOf(['parent', 'child'], [['child', 'parent']])
    const positions = { parent: { x: 40, y: 40 }, child: { x: 500, y: 40 } }
    const route = routeRelationships(schema, positions).get('r0')
    assert.equal(route?.sourceSide, 'l')
    assert.equal(route?.targetSide, 'r')
  })

  it('uses the other sides when the child is on the left', () => {
    const schema = schemaOf(['parent', 'child'], [['child', 'parent']])
    const positions = { parent: { x: 500, y: 40 }, child: { x: 40, y: 40 } }
    const route = routeRelationships(schema, positions).get('r0')
    assert.equal(route?.sourceSide, 'r')
    assert.equal(route?.targetSide, 'l')
  })

  it('draws a self reference as a loop on the right of the table', () => {
    const schema = schemaOf(['a'], [['a', 'a']])
    const positions = { a: { x: 40, y: 40 } }
    const route = routeRelationships(schema, positions).get('r0')
    const right = 40 + 220
    assert.ok(route)
    assert.ok(
      route.points.every((p) => p.x >= right),
      'the loop stays outside the table'
    )
    assert.ok(route.points.some((p) => p.x > right))
    assert.equal(route.sourceSide, 'r')
    assert.equal(route.targetSide, 'r')
  })

  it('never passes through a table in the example shop, laid out automatically', () => {
    const { schema } = createShopExample()
    const positions = layoutTables(schema)
    const rects = rectsOf(schema, positions)
    for (const [id, route] of routeRelationships(schema, positions)) {
      for (let i = 1; i < route.points.length; i++) {
        for (const r of rects) {
          assert.ok(
            !crosses(route.points[i - 1] as Point, route.points[i] as Point, r),
            `${id} goes through a table`
          )
        }
      }
    }
  })

  it('never passes through a table, for 100 random automatically laid out schemas', () => {
    let state = 31415
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 2 ** 32
    }
    for (let round = 0; round < 100; round++) {
      const count = 3 + Math.floor(next() * 7)
      const names = Array.from({ length: count }, (_, index) => `t${index}`)
      const references: [string, string][] = []
      for (let child = 1; child < count; child++) {
        for (let parent = 0; parent < child; parent++) {
          if (next() < 0.3)
            references.push([names[child] as string, names[parent] as string])
        }
      }
      const schema = schemaOf(names, references)
      const positions = layoutTables(schema)
      const rects = rectsOf(schema, positions)
      for (const [id, route] of routeRelationships(schema, positions)) {
        for (let i = 1; i < route.points.length; i++) {
          for (const r of rects) {
            assert.ok(
              !crosses(
                route.points[i - 1] as Point,
                route.points[i] as Point,
                r
              ),
              `round ${round}: ${id} goes through a table`
            )
          }
        }
      }
    }
  })
})
