import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Point, Rect } from '../../../../lib/geometry.ts'
import { routeEdge } from '../../../../lib/routing/route-edge.ts'

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
})

/** Whether an axis-aligned segment passes through the inside of a rectangle. */
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

const isOrthogonal = (points: Point[]) =>
  points.every(
    (p, i) => i === 0 || p.x === points[i - 1]?.x || p.y === points[i - 1]?.y
  )

const crossesAny = (points: Point[], rects: Rect[]) =>
  points.some(
    (p, i) => i > 0 && rects.some((r) => crosses(points[i - 1] as Point, p, r))
  )

describe('routeEdge', () => {
  it('is a straight line when nothing is in the way and the ends face each other', () => {
    const route = routeEdge(
      [],
      { point: { x: 0, y: 100 }, side: 'r' },
      { point: { x: 300, y: 100 }, side: 'l' }
    )
    assert.deepEqual(route.points, [
      { x: 0, y: 100 },
      { x: 300, y: 100 },
    ])
    assert.equal(route.cost, 300)
  })

  it('leaves a side outwards and arrives from the outside of the other', () => {
    const route = routeEdge(
      [],
      { point: { x: 0, y: 100 }, side: 'r' },
      { point: { x: 300, y: 220 }, side: 'l' }
    )
    assert.ok(isOrthogonal(route.points))
    const [start, next] = route.points
    assert.equal(next?.y, start?.y)
    assert.ok((next?.x ?? 0) > (start?.x ?? 0), 'it leaves to the right')
    const end = route.points.at(-1) as Point
    const before = route.points.at(-2) as Point
    assert.equal(before.y, end.y)
    assert.ok(before.x < end.x, 'it arrives moving right, into the left side')
  })

  it('arrives moving left into the right side of a table', () => {
    const route = routeEdge(
      [],
      { point: { x: 400, y: 100 }, side: 'l' },
      { point: { x: 100, y: 100 }, side: 'r' }
    )
    const end = route.points.at(-1) as Point
    const before = route.points.at(-2) as Point
    assert.ok(before.x > end.x)
  })

  it('goes round a table that is in the way', () => {
    const blocker = rect(100, 60, 100, 80)
    const route = routeEdge(
      [blocker],
      { point: { x: 0, y: 100 }, side: 'r' },
      { point: { x: 300, y: 100 }, side: 'l' }
    )
    assert.ok(isOrthogonal(route.points))
    assert.ok(!crossesAny(route.points, [blocker]))
    assert.ok(route.cost > 300)
  })

  it('keeps a margin from the tables it goes round', () => {
    const blocker = rect(100, 60, 100, 80)
    const route = routeEdge(
      [blocker],
      { point: { x: 0, y: 100 }, side: 'r' },
      { point: { x: 300, y: 100 }, side: 'l' }
    )
    const margin = rect(
      blocker.x - 10,
      blocker.y - 10,
      blocker.width + 20,
      blocker.height + 20
    )
    assert.ok(!crossesAny(route.points, [margin]), 'it hugs the table')
  })

  it('prefers fewer bends to a slightly shorter route', () => {
    const route = routeEdge(
      [],
      { point: { x: 0, y: 0 }, side: 'r' },
      { point: { x: 200, y: 100 }, side: 'l' }
    )
    const bends = route.points.length - 2
    assert.ok(bends <= 2, `${bends} bends`)
  })

  it('still returns a route that starts and ends at the two points when the way out is boxed in', () => {
    // a table right next to the source: the usual first step is blocked
    const neighbour = rect(10, 0, 100, 300)
    const route = routeEdge(
      [neighbour],
      { point: { x: 0, y: 100 }, side: 'r' },
      { point: { x: 400, y: 100 }, side: 'l' }
    )
    assert.deepEqual(route.points[0], { x: 0, y: 100 })
    assert.deepEqual(route.points.at(-1), { x: 400, y: 100 })
    assert.ok(Number.isFinite(route.cost))
    assert.ok(isOrthogonal(route.points))
  })

  it('is deterministic', () => {
    const obstacles = [rect(100, 40, 80, 100), rect(220, 150, 80, 90)]
    const a = routeEdge(
      obstacles,
      { point: { x: 0, y: 100 }, side: 'r' },
      { point: { x: 400, y: 200 }, side: 'l' }
    )
    const b = routeEdge(
      obstacles,
      { point: { x: 0, y: 100 }, side: 'r' },
      { point: { x: 400, y: 200 }, side: 'l' }
    )
    assert.deepEqual(a, b)
  })

  it('never goes through a table, for 200 random layouts', () => {
    let state = 424242
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 2 ** 32
    }
    for (let round = 0; round < 200; round++) {
      // a 4x3 lattice of tables with random sizes and jitter, 120px apart at least
      const rects: Rect[] = []
      for (let column = 0; column < 4; column++) {
        for (let row = 0; row < 3; row++) {
          if (next() < 0.35) continue
          rects.push(
            rect(
              column * 360 + Math.floor(next() * 40),
              row * 260 + Math.floor(next() * 40),
              220,
              60 + Math.floor(next() * 5) * 26
            )
          )
        }
      }
      if (rects.length < 2) continue
      const from = rects[Math.floor(next() * rects.length)] as Rect
      let to = rects[Math.floor(next() * rects.length)] as Rect
      if (to === from) to = rects.find((r) => r !== from) as Rect
      const sourceSide = next() < 0.5 ? 'l' : 'r'
      const targetSide = next() < 0.5 ? 'l' : 'r'
      const sourceY = from.y + 44 + Math.floor(next() * 2) * 26
      const targetY = to.y + 44 + Math.floor(next() * 2) * 26
      const route = routeEdge(
        rects,
        {
          point: {
            x: sourceSide === 'l' ? from.x : from.x + from.width,
            y: sourceY,
          },
          side: sourceSide,
        },
        {
          point: { x: targetSide === 'l' ? to.x : to.x + to.width, y: targetY },
          side: targetSide,
        }
      )
      assert.ok(isOrthogonal(route.points), `round ${round}: not orthogonal`)
      assert.ok(
        !crossesAny(route.points, rects),
        `round ${round}: goes through a table`
      )
    }
  })
})
