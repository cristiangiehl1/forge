import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../dialects/postgres.ts'
import { generateDdl } from '../../../sql/generate/generate-ddl.ts'
import { usersOrders } from '../../helpers/fixtures.ts'
import { column, schemaOf, table } from '../../helpers/schema-builders.ts'

const uuid = { kind: 'uuid' } as const

function resultOf(schema: Parameters<typeof generateDdl>[0]) {
  const result = generateDdl(schema, postgres)
  assert.ok(result.ok, JSON.stringify(result))
  return result
}

describe('the statements of a script', () => {
  it('has one CREATE TABLE per table, tagged with the table it creates', () => {
    const { statements } = resultOf(usersOrders)
    assert.deepEqual(
      statements.map((s) => [s.kind, s.tableId, s.key]),
      [
        ['create', 'users', 'create:users'],
        ['create', 'orders', 'create:orders'],
      ]
    )
    assert.ok(statements[1]?.sql.startsWith('CREATE TABLE "orders"'))
    assert.ok(statements[1]?.sql.includes('CONSTRAINT "fk_orders_user_id"'))
  })

  it('joins into exactly the script text', () => {
    const { sql, statements } = resultOf(usersOrders)
    assert.equal(sql, `${statements.map((s) => s.sql).join('\n\n')}\n`)
  })

  it('follows the order of creation, not the order of the schema', () => {
    const schema = schemaOf(
      [
        table(
          'o',
          'orders',
          [column('o.id', 'id', uuid, false), column('o.u', 'user_id', uuid)],
          ['o.id']
        ),
        table('u', 'users', [column('u.id', 'id', uuid, false)], ['u.id']),
      ],
      [
        {
          id: 'r',
          from: { tableId: 'o', columnId: 'o.u' },
          to: { tableId: 'u', columnId: 'u.id' },
        },
      ]
    )
    assert.deepEqual(
      resultOf(schema).statements.map((s) => s.tableId),
      ['u', 'o']
    )
  })

  it('tags an ALTER TABLE with the table that holds the foreign key and the relationship', () => {
    const schema = schemaOf(
      [
        table(
          'a',
          'a',
          [column('a.id', 'id', uuid, false), column('a.b', 'b_id', uuid)],
          ['a.id']
        ),
        table(
          'b',
          'b',
          [column('b.id', 'id', uuid, false), column('b.a', 'a_id', uuid)],
          ['b.id']
        ),
      ],
      [
        {
          id: 'r1',
          from: { tableId: 'a', columnId: 'a.b' },
          to: { tableId: 'b', columnId: 'b.id' },
        },
        {
          id: 'r2',
          from: { tableId: 'b', columnId: 'b.a' },
          to: { tableId: 'a', columnId: 'a.id' },
        },
      ]
    )
    const { statements, sql } = resultOf(schema)
    assert.deepEqual(
      statements.map((s) => s.key),
      ['create:b', 'create:a', 'alter:r2']
    )
    const alter = statements[2]
    assert.equal(alter?.kind, 'alter')
    assert.equal(alter?.tableId, 'b')
    assert.ok(alter?.kind === 'alter' && alter.relationshipId === 'r2')
    assert.ok(sql.includes(alter?.sql ?? ''))
  })

  it('has no statements for an empty schema', () => {
    assert.deepEqual(resultOf(schemaOf([])).statements, [])
  })
})
