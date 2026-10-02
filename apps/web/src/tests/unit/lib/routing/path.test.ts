import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { pathFromPoints, pointAlong } from '../../../../lib/routing/path.ts'

describe('pathFromPoints', () => {
  it('draws a straight line through two points', () => {
    assert.equal(
      pathFromPoints([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
      'M 0 0 L 100 0'
    )
  })

  it('rounds a corner with a quadratic curve', () => {
    assert.equal(
      pathFromPoints(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
        10
      ),
      'M 0 0 L 90 0 Q 100 0 100 10 L 100 100'
    )
  })

  it('does not round a point that is on a straight run', () => {
    assert.equal(
      pathFromPoints([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ]),
      'M 0 0 L 50 0 L 100 0'
    )
  })

  it('rounds less when the pieces on each side are short', () => {
    assert.equal(
      pathFromPoints(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 100 },
        ],
        10
      ),
      'M 0 0 L 5 0 Q 10 0 10 5 L 10 100'
    )
  })

  it('turns both ways', () => {
    assert.equal(
      pathFromPoints(
        [
          { x: 100, y: 100 },
          { x: 0, y: 100 },
          { x: 0, y: 0 },
        ],
        10
      ),
      'M 100 100 L 10 100 Q 0 100 0 90 L 0 0'
    )
  })

  it('has no path for fewer than two points', () => {
    assert.equal(pathFromPoints([]), '')
    assert.equal(pathFromPoints([{ x: 1, y: 1 }]), '')
  })
})

describe('pointAlong', () => {
  const l = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]

  it('finds the middle of a polyline by its length', () => {
    assert.deepEqual(pointAlong(l, 0.5), { x: 100, y: 0 })
  })

  it('finds a point inside a segment', () => {
    assert.deepEqual(pointAlong(l, 0.25), { x: 50, y: 0 })
    assert.deepEqual(pointAlong(l, 0.75), { x: 100, y: 50 })
  })

  it('returns the ends for 0 and 1', () => {
    assert.deepEqual(pointAlong(l, 0), { x: 0, y: 0 })
    assert.deepEqual(pointAlong(l, 1), { x: 100, y: 100 })
  })

  it('copes with a single point and with no length', () => {
    assert.deepEqual(pointAlong([{ x: 5, y: 6 }], 0.5), { x: 5, y: 6 })
    assert.deepEqual(
      pointAlong(
        [
          { x: 5, y: 6 },
          { x: 5, y: 6 },
        ],
        0.5
      ),
      { x: 5, y: 6 }
    )
  })
})
