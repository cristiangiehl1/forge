import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema } from '@forge/core'

import {
  columnOfHandle,
  connectionToRefs,
  handleId,
  resolvePositions,
  toFlowEdges,
  toFlowNodes,
} from '../../../../lib/canvas/to-flow.ts'
import { createView, nextNodePosition } from '../../../../lib/project-view.ts'
import { routeRelationships } from '../../../../lib/routing/route-relationships.ts'

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

describe('handle ids', () => {
  it('name the column and the side of the table', () => {
    assert.equal(handleId('c1', 'l'), 'c1:l')
    assert.equal(handleId('c1', 'r'), 'c1:r')
  })

  it('give the column back, whichever side', () => {
    assert.equal(columnOfHandle('c1:l'), 'c1')
    assert.equal(columnOfHandle('c1:r'), 'c1')
    assert.equal(columnOfHandle('some-uuid-1234:r'), 'some-uuid-1234')
  })

  it('leave an id without a side as it is', () => {
    assert.equal(columnOfHandle('c1'), 'c1')
  })
})

describe('resolvePositions', () => {
  it('uses the saved position and falls back to the grid', () => {
    const view = { ...createView(), nodes: { a: { x: 7, y: 8 } } }
    assert.deepEqual(resolvePositions(schema, view), {
      a: { x: 7, y: 8 },
      b: nextNodePosition(1),
    })
  })
})

describe('toFlowEdges', () => {
  const routes = routeRelationships(
    schema,
    resolvePositions(schema, createView())
  )

  it('creates one relationship edge per relationship, joining the sides its route chose', () => {
    const [edge] = toFlowEdges(schema, routes, null, null)
    const route = routes.get('r')
    assert.equal(edge?.id, 'r')
    assert.equal(edge?.type, 'relationship')
    assert.equal(edge?.source, 'b')
    assert.equal(edge?.target, 'a')
    assert.equal(edge?.sourceHandle, `b1:${route?.sourceSide}`)
    assert.equal(edge?.targetHandle, `a1:${route?.targetSide}`)
    assert.deepEqual(edge?.data?.points, route?.points)
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
    const both = routeRelationships(two, resolvePositions(two, createView()))
    assert.deepEqual(
      toFlowEdges(two, both, 's', null).map((edge) => edge.selected),
      [false, true]
    )
  })

  it('marks the relationships of the hovered table as related, and no others', () => {
    const two: Schema = {
      ...schema,
      tables: [
        ...schema.tables,
        {
          id: 'c',
          name: 'c',
          columns: [
            { id: 'c1', name: 'c1', type: { kind: 'uuid' }, nullable: false },
          ],
          primaryKey: [],
        },
      ],
      relationships: [
        ...schema.relationships,
        {
          id: 's',
          from: { tableId: 'c', columnId: 'c1' },
          to: { tableId: 'a', columnId: 'a1' },
        },
      ],
    }
    const all = routeRelationships(two, resolvePositions(two, createView()))
    const classes = (hovered: string | null) =>
      toFlowEdges(two, all, null, hovered).map((edge) => edge.className ?? '')
    assert.deepEqual(classes('b'), ['related', ''])
    assert.deepEqual(classes('a'), ['related', 'related'])
    assert.deepEqual(classes(null), ['', ''])
  })

  it('has no edges for a schema without relationships, and skips one without a route', () => {
    const none = { ...schema, relationships: [] }
    assert.deepEqual(toFlowEdges(none, new Map(), null, null), [])
    assert.deepEqual(toFlowEdges(schema, new Map(), null, null), [])
  })
})

describe('connectionToRefs', () => {
  it('turns a connection into from and to column references, whichever side the handles are on', () => {
    assert.deepEqual(
      connectionToRefs({
        source: 'b',
        sourceHandle: 'b1:l',
        target: 'a',
        targetHandle: 'a1:r',
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
        targetHandle: 'a1:l',
      }),
      null
    )
    assert.equal(connectionToRefs({ source: 'b', target: 'a' }), null)
  })
})
