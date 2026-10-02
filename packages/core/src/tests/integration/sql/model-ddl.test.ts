import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../dialects/postgres.ts'
import type {
  Column,
  ColumnType,
  Schema,
  Table,
  UserType,
} from '../../../schema/types.ts'
import { generateDdl } from '../../../sql/generate/generate-ddl.ts'

const col = (
  id: string,
  name: string,
  type: ColumnType = { kind: 'text' },
  extra: Partial<Column> = {}
): Column => ({
  id,
  name,
  type,
  nullable: true,
  ...extra,
})
const tbl = (
  id: string,
  name: string,
  columns: Column[],
  extra: Partial<Table> = {}
): Table => ({
  id,
  name,
  columns,
  primaryKey: [],
  ...extra,
})
const schemaOf = (tables: Table[], types?: UserType[]): Schema => ({
  version: 1,
  tables,
  relationships: [],
  ...(types ? { types } : {}),
})
const run = (schema: Schema) => {
  const result = generateDdl(schema, postgres)
  assert.equal(result.ok, true)
  return result.ok ? result : { sql: '', statements: [] }
}
const lines = (...parts: string[]) => `${parts.join('\n')}\n`

describe('generateDdl: a schema with none of the new fields', () => {
  it('is unchanged', () => {
    const { sql, statements } = run(
      schemaOf([tbl('t', 'users', [col('c', 'name')])])
    )
    assert.equal(sql, lines('CREATE TABLE "users" (', '  "name" text', ');'))
    assert.deepEqual(
      statements.map((s) => s.kind),
      ['create']
    )
  })
})

describe('generateDdl: defaults', () => {
  it('writes the raw default after the type and NOT NULL', () => {
    const columns = [
      col('a', 'n', { kind: 'integer' }, { default: '0', nullable: false }),
      col('b', 's', { kind: 'text' }, { default: "'it''s'" }),
      col('c', 'z', { kind: 'text' }, { default: '  ' }),
    ]
    assert.equal(
      run(schemaOf([tbl('t', 'x', columns)])).sql,
      lines(
        'CREATE TABLE "x" (',
        '  "n" integer NOT NULL DEFAULT 0,',
        `  "s" text DEFAULT 'it''s',`,
        '  "z" text',
        ');'
      )
    )
  })
})

describe('generateDdl: types', () => {
  const enumType: UserType = {
    kind: 'enum',
    id: 'e1',
    name: 'order status',
    values: ['new', "won't ship"],
  }

  it('creates an enum before the table that uses it, and writes the column type by name', () => {
    const { sql, statements } = run(
      schemaOf(
        [
          tbl('t', 'orders', [
            col('c', 'status', { kind: 'user', typeId: 'e1' }),
          ]),
        ],
        [enumType]
      )
    )
    assert.equal(
      sql,
      lines(
        `CREATE TYPE "order status" AS ENUM ('new', 'won''t ship');`,
        '',
        'CREATE TABLE "orders" (',
        '  "status" "order status"',
        ');'
      )
    )
    assert.deepEqual(
      statements.map((s) => s.kind),
      ['type', 'create']
    )
    assert.equal(statements[0]?.kind === 'type' && statements[0].typeId, 'e1')
  })

  it('creates a domain after the enum it uses, whatever the stored order', () => {
    const domain: UserType = {
      kind: 'domain',
      id: 'd1',
      name: 'shade',
      base: { kind: 'user', typeId: 'e1' },
      default: "'new'",
      notNull: true,
    }
    const { sql } = run(schemaOf([], [domain, enumType]))
    assert.equal(
      sql,
      lines(
        `CREATE TYPE "order status" AS ENUM ('new', 'won''t ship');`,
        '',
        `CREATE DOMAIN "shade" AS "order status" DEFAULT 'new' NOT NULL;`
      )
    )
  })

  it('writes arrays of user types', () => {
    const { sql } = run(
      schemaOf(
        [
          tbl('t', 'x', [
            col('c', 'tags', {
              kind: 'array',
              of: { kind: 'user', typeId: 'e1' },
            }),
          ]),
        ],
        [enumType]
      )
    )
    assert.ok(sql.includes('"tags" "order status"[]'))
  })
})

describe('generateDdl: indexes', () => {
  const columns = [col('c1', 'a'), col('c2', 'b')]
  const index = (over: object = {}) => ({
    id: 'i1',
    name: 'idx_x_a',
    columns: ['c1'],
    unique: false,
    method: 'btree' as const,
    ...over,
  })

  it('writes a plain, a unique, and a method index after the tables', () => {
    const { sql, statements } = run(
      schemaOf([
        tbl('t', 'x', columns, {
          indexes: [
            index(),
            index({
              id: 'i2',
              name: 'uq_x_a_b',
              columns: ['c1', 'c2'],
              unique: true,
            }),
            index({
              id: 'i3',
              name: 'idx_x_b',
              columns: ['c2'],
              method: 'gin',
            }),
          ],
        }),
      ])
    )
    assert.equal(
      sql,
      lines(
        'CREATE TABLE "x" (',
        '  "a" text,',
        '  "b" text',
        ');',
        '',
        'CREATE INDEX "idx_x_a" ON "x" ("a");',
        '',
        'CREATE UNIQUE INDEX "uq_x_a_b" ON "x" ("a", "b");',
        '',
        'CREATE INDEX "idx_x_b" ON "x" USING gin ("b");'
      )
    )
    const kinds = statements.map((s) => s.kind)
    assert.deepEqual(kinds, ['create', 'index', 'index', 'index'])
    const first = statements[1]
    assert.equal(first?.kind === 'index' && first.tableId, 't')
    assert.equal(first?.kind === 'index' && first.indexId, 'i1')
  })
})

describe('generateDdl: comments', () => {
  it('writes the table comment then the column comments, escaping quotes, skipping blanks', () => {
    const { sql, statements } = run(
      schemaOf([
        tbl(
          't',
          'x',
          [
            col('c1', 'a', { kind: 'text' }, { comment: "the user's name" }),
            col('c2', 'b', { kind: 'text' }, { comment: ' ' }),
          ],
          {
            comment: 'People',
          }
        ),
      ])
    )
    assert.equal(
      sql,
      lines(
        'CREATE TABLE "x" (',
        '  "a" text,',
        '  "b" text',
        ');',
        '',
        `COMMENT ON TABLE "x" IS 'People';`,
        '',
        `COMMENT ON COLUMN "x"."a" IS 'the user''s name';`
      )
    )
    assert.deepEqual(
      statements.map((s) => s.kind),
      ['create', 'comment', 'comment']
    )
    assert.equal(
      statements[1]?.kind === 'comment' && statements[1].tableId,
      't'
    )
  })
})

describe('generateDdl: the order of the whole script', () => {
  it('writes types, tables, foreign keys, indexes, then comments', () => {
    const enumType: UserType = {
      kind: 'enum',
      id: 'e1',
      name: 'k',
      values: ['a'],
    }
    const schema: Schema = {
      ...schemaOf(
        [
          tbl('t1', 'parent', [col('p', 'id', { kind: 'integer' })], {
            comment: 'P',
            primaryKey: ['p'],
          }),
          tbl(
            't2',
            'child',
            [
              col('q', 'parent_id', { kind: 'integer' }),
              col('k', 'kind', { kind: 'user', typeId: 'e1' }),
            ],
            {
              indexes: [
                {
                  id: 'i',
                  name: 'idx_child',
                  columns: ['q'],
                  unique: false,
                  method: 'btree',
                },
              ],
            }
          ),
        ],
        [enumType]
      ),
      relationships: [
        {
          id: 'r',
          from: { tableId: 't2', columnId: 'q' },
          to: { tableId: 't1', columnId: 'p' },
        },
      ],
    }
    const { statements } = run(schema)
    assert.deepEqual(
      statements.map((s) => s.kind),
      ['type', 'create', 'create', 'index', 'comment']
    )
  })
})
