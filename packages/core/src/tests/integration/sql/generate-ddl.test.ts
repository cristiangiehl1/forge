import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../dialects/postgres.ts'
import {
  addColumn,
  addRelationship,
  addTable,
  createSchema,
  setPrimaryKey,
} from '../../../schema/operations.ts'
import { byteLength } from '../../../sql/generate/constraint-names.ts'
import { generateDdl } from '../../../sql/generate/generate-ddl.ts'
import { usersOrders } from '../../helpers/fixtures.ts'
import { column, schemaOf, table } from '../../helpers/schema-builders.ts'

const uuid = { kind: 'uuid' } as const

function sqlOf(schema: Parameters<typeof generateDdl>[0]): string {
  const result = generateDdl(schema, postgres)
  assert.ok(result.ok, JSON.stringify(result))
  return result.sql
}

const lines = (...parts: string[]) => `${parts.join('\n')}\n`

const USERS_ORDERS_SQL = lines(
  'CREATE TABLE "users" (',
  '  "id" uuid NOT NULL,',
  '  "name" varchar(120) NOT NULL,',
  '  PRIMARY KEY ("id")',
  ');',
  '',
  'CREATE TABLE "orders" (',
  '  "id" uuid NOT NULL,',
  '  "user_id" uuid NOT NULL,',
  '  "total" numeric(10,2),',
  '  "created_at" timestamptz NOT NULL,',
  '  PRIMARY KEY ("id"),',
  '  CONSTRAINT "fk_orders_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id")',
  ');'
)

describe('generateDdl golden output', () => {
  it('declares a foreign key inside the table that holds it', () => {
    assert.equal(sqlOf(usersOrders), USERS_ORDERS_SQL)
  })

  it('generates the same SQL when the schema is built through operations', () => {
    let schema = createSchema()
    schema = addTable(schema, { id: 'users', name: 'users' })
    schema = addColumn(schema, 'users', column('u_id', 'id', uuid, false))
    schema = setPrimaryKey(schema, 'users', ['u_id'])
    schema = addTable(schema, { id: 'orders', name: 'orders' })
    schema = addColumn(schema, 'orders', column('o_user', 'user_id', uuid))
    schema = addRelationship(schema, {
      id: 'fk1',
      from: { tableId: 'orders', columnId: 'o_user' },
      to: { tableId: 'users', columnId: 'u_id' },
    })
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "users" (',
        '  "id" uuid NOT NULL,',
        '  PRIMARY KEY ("id")',
        ');',
        '',
        'CREATE TABLE "orders" (',
        '  "user_id" uuid,',
        '  CONSTRAINT "fk_orders_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id")',
        ');'
      )
    )
  })

  it('generates a composite primary key in key order', () => {
    const schema = schemaOf([
      table(
        'items',
        'order_items',
        [
          column('c1', 'order_id', uuid),
          column('c2', 'product_id', uuid),
          column('c3', 'quantity', { kind: 'integer' }, false),
        ],
        ['c2', 'c1']
      ),
    ])
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "order_items" (',
        '  "order_id" uuid NOT NULL,',
        '  "product_id" uuid NOT NULL,',
        '  "quantity" integer NOT NULL,',
        '  PRIMARY KEY ("product_id", "order_id")',
        ');'
      )
    )
  })

  it('quotes and escapes names', () => {
    const schema = schemaOf([
      table('t', 'Weird "Name"', [
        column('c1', 'my col'),
        column('c2', 'coluna_ção'),
      ]),
    ])
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "Weird ""Name""" (',
        '  "my col" text,',
        '  "coluna_ção" text',
        ');'
      )
    )
  })

  it('handles empty, columnless and key-less tables', () => {
    assert.equal(sqlOf(schemaOf([])), '')
    assert.equal(
      sqlOf(schemaOf([table('t', 'empty')])),
      lines('CREATE TABLE "empty" ();')
    )
    assert.equal(
      sqlOf(schemaOf([table('t', 'log', [column('c', 'message')])])),
      lines('CREATE TABLE "log" (', '  "message" text', ');')
    )
  })

  it('makes primary-key columns NOT NULL even when marked nullable', () => {
    const schema = schemaOf([
      table('t', 'a', [column('c', 'id', uuid, true)], ['c']),
    ])
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "a" (',
        '  "id" uuid NOT NULL,',
        '  PRIMARY KEY ("id")',
        ');'
      )
    )
  })

  it('declares a self-referencing foreign key inside its own table', () => {
    const schema = schemaOf(
      [
        table(
          'e',
          'employees',
          [
            column('e_id', 'id', uuid, false),
            column('e_mgr', 'manager_id', uuid),
          ],
          ['e_id']
        ),
      ],
      [
        {
          id: 'r',
          from: { tableId: 'e', columnId: 'e_mgr' },
          to: { tableId: 'e', columnId: 'e_id' },
        },
      ]
    )
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "employees" (',
        '  "id" uuid NOT NULL,',
        '  "manager_id" uuid,',
        '  PRIMARY KEY ("id"),',
        '  CONSTRAINT "fk_employees_manager_id" FOREIGN KEY ("manager_id") REFERENCES "employees" ("id")',
        ');'
      )
    )
  })

  it('breaks a cycle with a single ALTER TABLE and keeps the rest inside the tables', () => {
    const schema = schemaOf(
      [
        table(
          'a',
          'a',
          [column('a_id', 'id', uuid, false), column('a_b', 'b_id', uuid)],
          ['a_id']
        ),
        table(
          'b',
          'b',
          [column('b_id', 'id', uuid, false), column('b_a', 'a_id', uuid)],
          ['b_id']
        ),
      ],
      [
        {
          id: 'r1',
          from: { tableId: 'a', columnId: 'a_b' },
          to: { tableId: 'b', columnId: 'b_id' },
        },
        {
          id: 'r2',
          from: { tableId: 'b', columnId: 'b_a' },
          to: { tableId: 'a', columnId: 'a_id' },
        },
      ]
    )
    // b is created first (a needs it); b's own reference to a would point at a
    // table that does not exist yet, so that one, and only that one, is ALTERed.
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "b" (',
        '  "id" uuid NOT NULL,',
        '  "a_id" uuid,',
        '  PRIMARY KEY ("id")',
        ');',
        '',
        'CREATE TABLE "a" (',
        '  "id" uuid NOT NULL,',
        '  "b_id" uuid,',
        '  PRIMARY KEY ("id"),',
        '  CONSTRAINT "fk_a_b_id" FOREIGN KEY ("b_id") REFERENCES "b" ("id")',
        ');',
        '',
        'ALTER TABLE "b"',
        '  ADD CONSTRAINT "fk_b_a_id"',
        '  FOREIGN KEY ("a_id") REFERENCES "a" ("id");'
      )
    )
  })

  it('truncates long constraint names and keeps them unique', () => {
    const longA = `${'t'.repeat(70)}1`
    const longB = `${'t'.repeat(70)}2`
    const schema = schemaOf(
      [
        table(
          'ta',
          longA,
          [column('ta_id', 'id', uuid, false), column('ta_ref', 'ref', uuid)],
          ['ta_id']
        ),
        table('tb', longB, [column('tb_ref', 'ref', uuid)]),
      ],
      [
        {
          id: 'r1',
          from: { tableId: 'ta', columnId: 'ta_ref' },
          to: { tableId: 'ta', columnId: 'ta_id' },
        },
        {
          id: 'r2',
          from: { tableId: 'tb', columnId: 'tb_ref' },
          to: { tableId: 'ta', columnId: 'ta_id' },
        },
      ]
    )
    const sql = sqlOf(schema)
    const names = [...sql.matchAll(/CONSTRAINT "([^"]+)"/g)].map(
      (match) => match[1] ?? ''
    )
    assert.equal(names.length, 2)
    for (const name of names) assert.ok(byteLength(name) <= 63, name)
    assert.notEqual(names[0], names[1])
    assert.ok(names[1]?.endsWith('_2'))
    assert.ok(sql.includes(`"${longA}"`), 'table names are never truncated')
  })
})

describe('generateDdl with generated columns', () => {
  const generated = (
    id: string,
    name: string,
    kind: 'integer' | 'bigint' | 'uuid'
  ) => ({
    ...column(id, name, { kind }, false),
    generated: true,
  })

  it('declares a generated integer id as an identity column', () => {
    const schema = schemaOf([
      table(
        't',
        'users',
        [generated('c1', 'id', 'integer'), column('c2', 'name')],
        ['c1']
      ),
    ])
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "users" (',
        '  "id" integer NOT NULL GENERATED BY DEFAULT AS IDENTITY,',
        '  "name" text,',
        '  PRIMARY KEY ("id")',
        ');'
      )
    )
  })

  it('declares a generated uuid id with a default', () => {
    const schema = schemaOf([
      table('t', 'users', [generated('c1', 'id', 'uuid')], ['c1']),
    ])
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "users" (',
        '  "id" uuid NOT NULL DEFAULT gen_random_uuid(),',
        '  PRIMARY KEY ("id")',
        ');'
      )
    )
  })

  it('generates a bigint identity, and a generated column outside the key', () => {
    const schema = schemaOf([
      table(
        't',
        'events',
        [
          generated('c1', 'id', 'bigint'),
          { ...column('c2', 'seq', { kind: 'integer' }), generated: true },
        ],
        ['c1']
      ),
    ])
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "events" (',
        '  "id" bigint NOT NULL GENERATED BY DEFAULT AS IDENTITY,',
        '  "seq" integer NOT NULL GENERATED BY DEFAULT AS IDENTITY,',
        '  PRIMARY KEY ("id")',
        ');'
      )
    )
  })

  it('says NOT NULL for a nullable identity column, because PostgreSQL makes it so', () => {
    const schema = schemaOf([
      table('t', 'events', [
        { ...column('c1', 'seq', { kind: 'integer' }, true), generated: true },
      ]),
    ])
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "events" (',
        '  "seq" integer NOT NULL GENERATED BY DEFAULT AS IDENTITY',
        ');'
      )
    )
  })

  it('leaves a nullable generated uuid nullable: a default does not forbid NULL', () => {
    const schema = schemaOf([
      table('t', 'events', [
        { ...column('c1', 'token', { kind: 'uuid' }, true), generated: true },
      ]),
    ])
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "events" (',
        '  "token" uuid DEFAULT gen_random_uuid()',
        ');'
      )
    )
  })

  it('refuses to generate DDL for a generated column of an unsupported type', () => {
    const schema = schemaOf([
      table('t', 'users', [{ ...column('c1', 'name'), generated: true }]),
    ])
    const result = generateDdl(schema, postgres)
    assert.ok(!result.ok)
    assert.equal(result.issues[0]?.code, 'generated-unsupported-type')
  })

  it('generates exactly the same SQL for a schema saved before generated columns existed', () => {
    assert.equal(
      sqlOf(JSON.parse(JSON.stringify(usersOrders))),
      USERS_ORDERS_SQL
    )
    assert.ok(!USERS_ORDERS_SQL.includes('GENERATED'))
  })
})
