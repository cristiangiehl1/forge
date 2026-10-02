import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema } from '@forge/core'

import { NODE_WIDTH, nodeRect } from '../../../../lib/geometry.ts'
import { layoutTables } from '../../../../lib/layout/layout-tables.ts'

/** Tables named by letters; each has an id column and `columns` more. */
function schemaOf(
  names: string[],
  references: [child: string, parent: string][] = [],
  columns = 3
): Schema {
  return {
    version: 1,
    tables: names.map((name) => ({
      id: name,
      name,
      columns: Array.from({ length: columns + 1 }, (_, index) => ({
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

const rectOf = (schema: Schema, id: string, at: { x: number; y: number }) =>
  nodeRect(at, schema.tables.find((t) => t.id === id)?.columns.length ?? 0)

function overlap(
  a: ReturnType<typeof nodeRect>,
  b: ReturnType<typeof nodeRect>
) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

function assertNoOverlaps(
  schema: Schema,
  positions: ReturnType<typeof layoutTables>
) {
  const ids = schema.tables.map((t) => t.id)
  for (const id of ids) assert.ok(positions[id], `${id} has no position`)
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] as string
      const b = ids[j] as string
      assert.ok(
        !overlap(
          rectOf(schema, a, positions[a] as never),
          rectOf(schema, b, positions[b] as never)
        ),
        `${a} and ${b} overlap`
      )
    }
  }
}

describe('layoutTables', () => {
  it('lays out nothing for an empty schema', () => {
    assert.deepEqual(layoutTables(schemaOf([])), {})
  })

  it('puts a lone table at the origin', () => {
    assert.deepEqual(layoutTables(schemaOf(['a'])), { a: { x: 40, y: 40 } })
  })

  it('puts a referenced table to the left of the table that references it', () => {
    const positions = layoutTables(
      schemaOf(['child', 'parent'], [['child', 'parent']])
    )
    assert.ok((positions.parent?.x ?? 0) < (positions.child?.x ?? 0))
  })

  it('moves one layer to the right for every step down a chain', () => {
    const positions = layoutTables(
      schemaOf(
        ['c', 'b', 'a'],
        [
          ['c', 'b'],
          ['b', 'a'],
        ]
      ),
      { gapX: 100 }
    )
    assert.equal(
      (positions.b?.x ?? 0) - (positions.a?.x ?? 0),
      NODE_WIDTH + 100
    )
    assert.equal(
      (positions.c?.x ?? 0) - (positions.b?.x ?? 0),
      NODE_WIDTH + 100
    )
  })

  it('puts a table after the deepest table it references', () => {
    // items references both orders (layer 2) and products (layer 1): layer 3
    const positions = layoutTables(
      schemaOf(
        ['users', 'products', 'orders', 'items'],
        [
          ['orders', 'users'],
          ['items', 'orders'],
          ['items', 'products'],
        ]
      )
    )
    const x = (id: string) => positions[id]?.x ?? Number.NaN
    assert.ok(x('users') < x('orders'))
    assert.ok(x('orders') < x('items'))
    assert.ok(x('products') < x('items'))
    assert.equal(x('items') - x('orders'), x('orders') - x('users'))
  })

  it('keeps sibling tables next to each other and in the order of their own children', () => {
    // C is listed before B, but D references B and E references C: the second
    // layer should follow whichever order removes the crossing.
    const positions = layoutTables(
      schemaOf(
        ['p', 'c', 'b', 'e', 'd'],
        [
          ['c', 'p'],
          ['b', 'p'],
          ['e', 'c'],
          ['d', 'b'],
        ]
      )
    )
    const y = (id: string) => positions[id]?.y ?? Number.NaN
    assert.equal(y('b') < y('c'), y('d') < y('e'), 'the children cross')
  })

  it('does not overlap any two tables, and gives every table a position', () => {
    const schema = schemaOf(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      [
        ['b', 'a'],
        ['c', 'a'],
        ['d', 'b'],
        ['d', 'c'],
        ['e', 'd'],
        ['f', 'a'],
      ]
    )
    assertNoOverlaps(schema, layoutTables(schema))
  })

  it('places every table of a cycle without failing', () => {
    const schema = schemaOf(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
      ]
    )
    const positions = layoutTables(schema)
    assertNoOverlaps(schema, positions)
    const xs = new Set(schema.tables.map((t) => positions[t.id]?.x))
    assert.ok(xs.size >= 2, 'a cycle still spreads over more than one layer')
  })

  it('ignores a table that references itself when choosing its layer', () => {
    const positions = layoutTables(
      schemaOf(
        ['a', 'b'],
        [
          ['a', 'a'],
          ['b', 'a'],
        ]
      )
    )
    assert.ok((positions.a?.x ?? 0) < (positions.b?.x ?? 0))
  })

  it('stacks unrelated groups of tables, one below the other', () => {
    const schema = schemaOf(
      ['a', 'b', 'c', 'd'],
      [
        ['b', 'a'],
        ['d', 'c'],
      ]
    )
    const positions = layoutTables(schema)
    assertNoOverlaps(schema, positions)
    assert.notEqual(positions.a?.y, positions.c?.y)
  })

  it('puts tables without any relationship in a grid below the connected ones', () => {
    const schema = schemaOf(['a', 'b', 'x', 'y', 'z', 'w'], [['b', 'a']])
    const positions = layoutTables(schema, { looseColumns: 2 })
    assertNoOverlaps(schema, positions)
    const connectedBottom = Math.max(
      ...['a', 'b'].map(
        (id) =>
          rectOf(schema, id, positions[id] as never).y +
          rectOf(schema, id, positions[id] as never).height
      )
    )
    for (const id of ['x', 'y', 'z', 'w']) {
      assert.ok(
        (positions[id]?.y ?? 0) >= connectedBottom,
        `${id} is not below`
      )
    }
    assert.equal(positions.x?.x, positions.z?.x)
    assert.notEqual(positions.x?.x, positions.y?.x)
  })

  it('snaps every position to a multiple of 10', () => {
    const schema = schemaOf(
      ['a', 'b', 'c'],
      [
        ['b', 'a'],
        ['c', 'a'],
      ]
    )
    for (const position of Object.values(layoutTables(schema))) {
      assert.equal(position.x % 10, 0)
      assert.equal(position.y % 10, 0)
    }
  })

  it('starts at the origin it is given', () => {
    const positions = layoutTables(schemaOf(['a', 'b'], [['b', 'a']]), {
      origin: { x: 0, y: 0 },
    })
    assert.equal(Math.min(...Object.values(positions).map((p) => p.x)), 0)
    assert.equal(Math.min(...Object.values(positions).map((p) => p.y)), 0)
  })

  it('gives the same answer every time', () => {
    const schema = schemaOf(
      ['a', 'b', 'c', 'd'],
      [
        ['b', 'a'],
        ['c', 'a'],
        ['d', 'b'],
      ]
    )
    assert.deepEqual(layoutTables(schema), layoutTables(schema))
  })

  it('never overlaps two tables and always places them, for 300 random schemas', () => {
    let state = 20261003
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 2 ** 32
    }
    for (let round = 0; round < 300; round++) {
      const count = 1 + Math.floor(next() * 9)
      const names = Array.from({ length: count }, (_, index) => `t${index}`)
      const references: [string, string][] = []
      for (const child of names) {
        for (const parent of names) {
          if (next() < 0.18) references.push([child, parent])
        }
      }
      const schema = schemaOf(names, references, 1 + Math.floor(next() * 5))
      assertNoOverlaps(schema, layoutTables(schema))
    }
  })

  it('puts the parent left of the child for every reference of 300 random acyclic schemas', () => {
    let state = 99
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 2 ** 32
    }
    for (let round = 0; round < 300; round++) {
      const count = 2 + Math.floor(next() * 8)
      const names = Array.from({ length: count }, (_, index) => `t${index}`)
      const references: [string, string][] = []
      for (let child = 1; child < count; child++) {
        for (let parent = 0; parent < child; parent++) {
          if (next() < 0.3)
            references.push([names[child] as string, names[parent] as string])
        }
      }
      const positions = layoutTables(schemaOf(names, references))
      for (const [child, parent] of references) {
        assert.ok(
          (positions[parent]?.x ?? 0) < (positions[child]?.x ?? 0),
          `round ${round}: ${parent} is not left of ${child}`
        )
      }
    }
  })
})
