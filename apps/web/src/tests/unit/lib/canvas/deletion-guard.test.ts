import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { edgesOnly } from '../../../../lib/canvas/deletion-guard.ts'

describe('edgesOnly', () => {
  it('allows deleting selected edges when no table is involved', () => {
    const edges = [{ id: 'r1' }, { id: 'r2' }]
    assert.deepEqual(edgesOnly({ nodes: [], edges }), { nodes: [], edges })
  })

  it('refuses everything when a table is among the elements to delete', () => {
    assert.equal(edgesOnly({ nodes: [{ id: 'a' }], edges: [] }), false)
  })

  it('refuses the relationships that would go with a selected table', () => {
    assert.equal(
      edgesOnly({ nodes: [{ id: 'a' }], edges: [{ id: 'r1' }] }),
      false
    )
  })

  it('allows an empty deletion', () => {
    assert.deepEqual(edgesOnly({ nodes: [], edges: [] }), {
      nodes: [],
      edges: [],
    })
  })
})
