import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createView,
  DEFAULT_VIEWPORT,
  nextNodePosition,
  parseView,
  pruneView,
} from '../../../lib/project-view.ts'

describe('createView', () => {
  it('starts with no nodes and the default viewport', () => {
    assert.deepEqual(createView(), { nodes: {}, viewport: DEFAULT_VIEWPORT })
  })
})

describe('nextNodePosition', () => {
  it('fills a three-column grid row by row', () => {
    assert.deepEqual(nextNodePosition(0), { x: 40, y: 40 })
    assert.deepEqual(nextNodePosition(1), { x: 360, y: 40 })
    assert.deepEqual(nextNodePosition(2), { x: 680, y: 40 })
    assert.deepEqual(nextNodePosition(3), { x: 40, y: 300 })
  })
})

describe('parseView', () => {
  it('reads a valid view', () => {
    const view = {
      nodes: { t1: { x: 5, y: 6 } },
      viewport: { x: 1, y: 2, zoom: 1.5 },
    }
    assert.deepEqual(parseView(view), view)
  })

  it('falls back to the default view for anything that is not an object', () => {
    for (const input of [null, undefined, 5, 'text', [], true]) {
      assert.deepEqual(parseView(input), createView())
    }
  })

  it('drops node entries with invalid coordinates', () => {
    const view = parseView({
      nodes: {
        ok: { x: 1, y: 2 },
        missing: { x: 1 },
        text: { x: '1', y: 2 },
        nan: { x: Number.NaN, y: 0 },
        wrong: 7,
      },
    })
    assert.deepEqual(Object.keys(view.nodes), ['ok'])
  })

  it('falls back to the default viewport when it is invalid', () => {
    assert.deepEqual(
      parseView({ viewport: { x: 0, y: 0, zoom: 0 } }).viewport,
      DEFAULT_VIEWPORT
    )
    assert.deepEqual(
      parseView({ viewport: { x: Number.NaN, y: 0, zoom: 1 } }).viewport,
      DEFAULT_VIEWPORT
    )
    assert.deepEqual(parseView({ viewport: 'x' }).viewport, DEFAULT_VIEWPORT)
  })

  it('does not let a "__proto__" key change the prototype of the nodes', () => {
    const parsed = parseView(
      JSON.parse('{"nodes":{"__proto__":{"x":1,"y":2},"t":{"x":3,"y":4}}}')
    )
    assert.equal(Object.getPrototypeOf(parsed.nodes), Object.prototype)
    assert.deepEqual(Object.keys(parsed.nodes).sort(), ['__proto__', 't'])
  })
})

describe('pruneView', () => {
  it('keeps only the positions of tables that exist', () => {
    const view = {
      nodes: { a: { x: 1, y: 2 }, gone: { x: 3, y: 4 } },
      viewport: { x: 0, y: 0, zoom: 2 },
    }
    assert.deepEqual(pruneView(view, ['a', 'b']), {
      nodes: { a: { x: 1, y: 2 } },
      viewport: { x: 0, y: 0, zoom: 2 },
    })
  })

  it('returns the same view when nothing has to go', () => {
    const view = {
      nodes: { a: { x: 1, y: 2 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    assert.equal(pruneView(view, ['a']), view)
  })
})
