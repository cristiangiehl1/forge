import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema } from '@forge/core'

import {
  connectionToRefs,
  toFlowEdges,
  toFlowNodes,
} from '../../../../lib/canvas/to-flow.ts'
import { createView, nextNodePosition } from '../../../../lib/project-view.ts'

const schema: Schema = {
  version: 1,
  tables: [
    {
      id: 'a',
      name: 'a',
      columns: [
        { id: 'a1', name: 'id', type: { kind: 'uuid' }, nullable: false },
      ],
      primaryKey: ['a1'],
    },
    {
      id: 'b',
      name: 'b',
      columns: [
        { id: 'b1', name: 'a_id', type: { kind: 'uuid' }, nullable: true },
      ],
      primaryKey: [],
    },
  ],
  relationships: [
    {
      id: 'r',
      from: { tableId: 'b', columnId: 'b1' },
      to: { tableId: 'a', columnId: 'a1' },
    },
  ],
}

describe('toFlowNodes', () => {
  it('creates one table node per table that carries only the table id', () => {
    const nodes = toFlowNodes(schema, createView(), null)
    assert.equal(nodes.length, 2)
    assert.equal(nodes[0]?.id, 'a')
    assert.equal(nodes[0]?.type, 'table')
    assert.deepEqual(nodes[0]?.data, { tableId: 'a' })
  })

  it('uses the saved position and falls back to the grid', () => {
    const view = { ...createView(), nodes: { a: { x: 7, y: 8 } } }
    const nodes = toFlowNodes(schema, view, null)
    assert.deepEqual(nodes[0]?.position, { x: 7, y: 8 })
    assert.deepEqual(nodes[1]?.position, nextNodePosition(1))
  })

  it('marks only the selected table as selected', () => {
    const nodes = toFlowNodes(schema, createView(), 'b')
    assert.deepEqual(
      nodes.map((node) => node.selected),
      [false, true]
    )
  })
})

describe('toFlowEdges', () => {
  it('creates one edge per relationship from column handle to column handle', () => {
    assert.deepEqual(toFlowEdges(schema, null), [
      {
        id: 'r',
        type: 'relationship',
        source: 'b',
        sourceHandle: 'b1',
        target: 'a',
        targetHandle: 'a1',
        selected: false,
      },
    ])
  })

  it('marks only the selected relationship as selected', () => {
    const two: Schema = {
      ...schema,
      relationships: [
        ...schema.relationships,
        {
          id: 's',
          from: { tableId: 'a', columnId: 'a1' },
          to: { tableId: 'a', columnId: 'a1' },
        },
      ],
    }
    assert.deepEqual(
      toFlowEdges(two, 's').map((edge) => edge.selected),
      [false, true]
    )
  })

  it('returns no edges for a schema without relationships', () => {
    assert.deepEqual(toFlowEdges({ ...schema, relationships: [] }, null), [])
  })
})

describe('connectionToRefs', () => {
  it('turns a connection into from and to column references', () => {
    assert.deepEqual(
      connectionToRefs({
        source: 'b',
        sourceHandle: 'b1',
        target: 'a',
        targetHandle: 'a1',
      }),
      {
        from: { tableId: 'b', columnId: 'b1' },
        to: { tableId: 'a', columnId: 'a1' },
      }
    )
  })

  it('returns null when a handle is missing', () => {
    assert.equal(
      connectionToRefs({
        source: 'b',
        sourceHandle: null,
        target: 'a',
        targetHandle: 'a1',
      }),
      null
    )
    assert.equal(connectionToRefs({ source: 'b', target: 'a' }), null)
  })
})
