import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../dialects/postgres.ts'
import type { Relationship, Schema } from '../../../schema/types.ts'
import { generateDdl } from '../../../sql/generate/generate-ddl.ts'
import { column, schemaOf, table } from '../../helpers/schema-builders.ts'

const uuid = { kind: 'uuid' } as const

/** A table with `id` (the primary key) and one nullable uuid column per name. */
const withRefs = (name: string, refs: string[] = []) =>
  table(
    name,
    name,
    [
      column(`${name}.id`, 'id', uuid, false),
      ...refs.map((ref) => column(`${name}.${ref}`, ref, uuid)),
    ],
    [`${name}.id`]
  )

/** `from.column` references `to.id`. */
const ref = (
  id: string,
  from: string,
  column: string,
  to: string
): Relationship => ({
  id,
  from: { tableId: from, columnId: `${from}.${column}` },
  to: { tableId: to, columnId: `${to}.id` },
})

function sqlOf(schema: Schema): string {
  const result = generateDdl(schema, postgres)
  assert.ok(result.ok, JSON.stringify(result))
  return result.sql
}

const createdTables = (sql: string) =>
  [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1])
const alteredTables = (sql: string) =>
  [...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((match) => match[1])

describe('where a foreign key is declared', () => {
  it('creates a referenced table before the table that references it', () => {
    const schema = schemaOf(
      [withRefs('orders', ['user_id']), withRefs('users')],
      [ref('r', 'orders', 'user_id', 'users')]
    )
    assert.deepEqual(createdTables(sqlOf(schema)), ['users', 'orders'])
    assert.deepEqual(alteredTables(sqlOf(schema)), [])
  })

  it('keeps the schema order when no reference forces a move', () => {
    const schema = schemaOf([withRefs('c'), withRefs('a'), withRefs('b')])
    assert.deepEqual(createdTables(sqlOf(schema)), ['c', 'a', 'b'])
  })

  it('pulls a table right before the first table that needs it, and nothing else', () => {
    const schema = schemaOf(
      [withRefs('a', ['c_id']), withRefs('b'), withRefs('c')],
      [ref('r', 'a', 'c_id', 'c')]
    )
    assert.deepEqual(createdTables(sqlOf(schema)), ['c', 'a', 'b'])
  })

  it('orders a chain of references from the end of the chain', () => {
    const schema = schemaOf(
      [withRefs('a', ['b_id']), withRefs('b', ['c_id']), withRefs('c')],
      [ref('r1', 'a', 'b_id', 'b'), ref('r2', 'b', 'c_id', 'c')]
    )
    assert.deepEqual(createdTables(sqlOf(schema)), ['c', 'b', 'a'])
    assert.deepEqual(alteredTables(sqlOf(schema)), [])
  })

  it('declares several references of one table in the order they were drawn', () => {
    const schema = schemaOf(
      [withRefs('x'), withRefs('y'), withRefs('z', ['y_id', 'x_id'])],
      [ref('r1', 'z', 'x_id', 'x'), ref('r2', 'z', 'y_id', 'y')]
    )
    const sql = sqlOf(schema)
    assert.ok(
      sql.indexOf('"fk_z_x_id"') < sql.indexOf('"fk_z_y_id"'),
      'the first relationship drawn comes first'
    )
    assert.deepEqual(alteredTables(sql), [])
  })

  it('breaks a three-table cycle with a single ALTER TABLE', () => {
    const schema = schemaOf(
      [
        withRefs('a', ['b_id']),
        withRefs('b', ['c_id']),
        withRefs('c', ['a_id']),
      ],
      [
        ref('r1', 'a', 'b_id', 'b'),
        ref('r2', 'b', 'c_id', 'c'),
        ref('r3', 'c', 'a_id', 'a'),
      ]
    )
    const sql = sqlOf(schema)
    assert.deepEqual(createdTables(sql), ['c', 'b', 'a'])
    assert.deepEqual(alteredTables(sql), ['c'])
    assert.ok(sql.includes('CONSTRAINT "fk_b_c_id" FOREIGN KEY'))
    assert.ok(sql.includes('CONSTRAINT "fk_a_b_id" FOREIGN KEY'))
  })

  it('keeps every other reference inside the table when one is part of a cycle', () => {
    const schema = schemaOf(
      [withRefs('a', ['b_id', 'c_id']), withRefs('b', ['a_id']), withRefs('c')],
      [
        ref('r1', 'a', 'b_id', 'b'),
        ref('r2', 'b', 'a_id', 'a'),
        ref('r3', 'a', 'c_id', 'c'),
      ]
    )
    const sql = sqlOf(schema)
    assert.deepEqual(createdTables(sql), ['b', 'c', 'a'])
    assert.deepEqual(alteredTables(sql), ['b'])
    assert.ok(sql.includes('CONSTRAINT "fk_a_b_id" FOREIGN KEY'))
    assert.ok(sql.includes('CONSTRAINT "fk_a_c_id" FOREIGN KEY'))
  })

  it('gives every constraint its own name even when inline and ALTERed ones collide', () => {
    const longA = `${'t'.repeat(70)}1`
    const longB = `${'t'.repeat(70)}2`
    const schema = schemaOf(
      [withRefs(longA, ['ref']), withRefs(longB, ['ref'])],
      [ref('r1', longA, 'ref', longB), ref('r2', longB, 'ref', longA)]
    )
    const names = [...sqlOf(schema).matchAll(/CONSTRAINT "([^"]+)"/g)].map(
      (match) => match[1]
    )
    assert.equal(names.length, 2)
    assert.notEqual(names[0], names[1])
  })
})

describe('every relationship is declared exactly once, and never before its table exists', () => {
  // A small seeded generator, so the same schemas are tried on every run.
  function random(seed: number) {
    let state = seed
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 2 ** 32
    }
  }

  function randomSchema(next: () => number): Schema {
    const count = 1 + Math.floor(next() * 6)
    const names = Array.from({ length: count }, (_, index) => `t${index}`)
    const columns = ['p', 'q', 'r']
    const relationships: Relationship[] = []
    const tables = names.map((name) => withRefs(name, columns))
    for (const name of names) {
      for (const columnName of columns) {
        if (next() < 0.5) {
          const target = names[Math.floor(next() * count)] ?? names[0] ?? name
          relationships.push(
            ref(`${name}.${columnName}`, name, columnName, target)
          )
        }
      }
    }
    return schemaOf(tables, relationships)
  }

  it('holds for 400 random schemas', () => {
    const next = random(20261002)
    for (let round = 0; round < 400; round++) {
      const schema = randomSchema(next)
      const sql = sqlOf(schema)
      const statements = sql.trimEnd().split('\n\n')

      const created: string[] = []
      let declared = 0
      const names: string[] = []
      for (const statement of statements) {
        const create = /^CREATE TABLE "([^"]+)"/.exec(statement)
        const alter = /^ALTER TABLE "([^"]+)"/.exec(statement)
        if (create) {
          const self = create[1] as string
          for (const match of statement.matchAll(
            /CONSTRAINT "([^"]+)" FOREIGN KEY \("[^"]+"\) REFERENCES "([^"]+)"/g
          )) {
            declared++
            names.push(match[1] as string)
            const target = match[2] as string
            assert.ok(
              target === self || created.includes(target),
              `round ${round}: "${self}" references "${target}" before it is created`
            )
          }
          created.push(self)
        } else if (alter) {
          assert.equal(
            created.length,
            schema.tables.length,
            `round ${round}: an ALTER TABLE comes before the last CREATE TABLE`
          )
          declared++
          names.push(/ADD CONSTRAINT "([^"]+)"/.exec(statement)?.[1] as string)
        }
      }

      assert.equal(
        declared,
        schema.relationships.length,
        `round ${round}: a relationship was lost or repeated`
      )
      assert.equal(
        new Set(names).size,
        names.length,
        `round ${round}: a constraint name repeats`
      )
      assert.equal(created.length, schema.tables.length)
    }
  })
})
