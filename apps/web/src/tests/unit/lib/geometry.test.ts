import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  HEADER_HEIGHT,
  handlePoint,
  NODE_WIDTH,
  nodeHeight,
  nodeRect,
  ROW_HEIGHT,
  rowCenterY,
} from '../../../lib/geometry.ts'

describe('the size of a table node', () => {
  it('is a fixed width, and a height that grows with the columns', () => {
    assert.equal(NODE_WIDTH, 220)
    assert.equal(nodeHeight(0), 33)
    assert.equal(nodeHeight(1), 59)
    assert.equal(nodeHeight(6), 33 + 6 * ROW_HEIGHT)
  })

  it('is placed by its top-left corner', () => {
    assert.deepEqual(nodeRect({ x: 40, y: 80 }, 2), {
      x: 40,
      y: 80,
      width: 220,
      height: nodeHeight(2),
    })
  })
})

describe('where a column row sits', () => {
  it('has its centre below the header, one row height apart', () => {
    assert.equal(rowCenterY({ x: 0, y: 100 }, 0), 100 + 1 + HEADER_HEIGHT + 13)
    assert.equal(
      rowCenterY({ x: 0, y: 100 }, 2) - rowCenterY({ x: 0, y: 100 }, 1),
      ROW_HEIGHT
    )
  })

  it('has a connection point on each side of the node, level with the row', () => {
    const left = handlePoint({ x: 40, y: 100 }, 1, 'l')
    const right = handlePoint({ x: 40, y: 100 }, 1, 'r')
    assert.equal(left.x, 40)
    assert.equal(right.x, 40 + NODE_WIDTH)
    assert.equal(left.y, right.y)
    assert.equal(left.y, rowCenterY({ x: 40, y: 100 }, 1))
  })
})
