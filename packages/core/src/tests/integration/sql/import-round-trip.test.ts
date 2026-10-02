import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../dialects/postgres.ts'
import {
  addColumn,
  addIndex,
  addRelationship,
  addTable,
  addType,
  createSchema,
  setPrimaryKey,
  setTableComment,
} from '../../../schema/operations.ts'
import type { Schema } from '../../../schema/types.ts'
import { generateDdl } from '../../../sql/generate/generate-ddl.ts'
import { importSql } from '../../../sql/parse/import-sql.ts'

/** A schema with ids replaced by names, so two schemas can be compared. */
function normalize(schema: Schema) {
  const typeName = (id: string) => schema.types?.find((t) => t.id === id)?.name
  const describeType = (
    type: Schema['tables'][number]['columns'][number]['type']
  ): unknown => {
    if (type.kind === 'user')
      return { kind: 'user', name: typeName(type.typeId) }
    if (type.kind === 'array')
      return { kind: 'array', of: describeType(type.of) }
    return type
  }
  return {
    types: (schema.types ?? []).map((t) =>
      t.kind === 'enum'
        ? { kind: t.kind, name: t.name, values: t.values }
        : {
            kind: t.kind,
            name: t.name,
            base: describeType(t.base),
            notNull: t.notNull ?? false,
            default: t.default ?? null,
          }
    ),
    tables: schema.tables.map((table) => {
      const name = (id: string) => table.columns.find((c) => c.id === id)?.name
      return {
        name: table.name,
        comment: table.comment ?? null,
        primaryKey: table.primaryKey.map(name),
        columns: table.columns.map((c) => ({
          name: c.name,
          type: describeType(c.type),
          // A primary key and an integer identity are NOT NULL whatever the model says.
          notNull:
            !c.nullable ||
            table.primaryKey.includes(c.id) ||
            (c.generated === true &&
              (c.type.kind === 'integer' || c.type.kind === 'bigint')),
          generated: c.generated ?? false,
          default: c.default ?? null,
          comment: c.comment ?? null,
        })),
        indexes: (table.indexes ?? []).map((i) => ({
          name: i.name,
          columns: i.columns.map(name),
          unique: i.unique,
          method: i.method,
        })),
      }
    }),
    relationships: schema.relationships.map((r) => {
      const from = schema.tables.find((t) => t.id === r.from.tableId)
      const to = schema.tables.find((t) => t.id === r.to.tableId)
      return [
        `${from?.name}.${from?.columns.find((c) => c.id === r.from.columnId)?.name}`,
        `${to?.name}.${to?.columns.find((c) => c.id === r.to.columnId)?.name}`,
      ]
    }),
  }
}

function sample(): Schema {
  let s = addType(createSchema(), {
    kind: 'enum',
    id: 'e1',
    name: 'order status',
    values: ['new', "won't ship"],
  })
  s = addType(s, {
    kind: 'domain',
    id: 'd1',
    name: 'shade',
    base: { kind: 'user', typeId: 'e1' },
    default: "'new'",
    notNull: true,
  })
  s = addTable(s, { id: 'u', name: 'users' })
  s = addColumn(s, 'u', {
    id: 'u1',
    name: 'id',
    type: { kind: 'integer' },
    nullable: false,
    generated: true,
  })
  s = addColumn(s, 'u', {
    id: 'u2',
    name: 'email',
    type: { kind: 'varchar', length: 255 },
    nullable: false,
    comment: "the user's login",
  })
  s = addColumn(s, 'u', {
    id: 'u3',
    name: 'created_at',
    type: { kind: 'timestamp' },
    nullable: false,
    generated: true,
  })
  s = addColumn(s, 'u', {
    id: 'u4',
    name: 'born',
    type: { kind: 'timestamp_no_tz' },
    nullable: true,
  })
  s = addColumn(s, 'u', {
    id: 'u5',
    name: 'score',
    type: { kind: 'numeric', precision: 10, scale: 2 },
    nullable: true,
    default: '0',
  })
  s = addColumn(s, 'u', {
    id: 'u6',
    name: 'tags',
    type: { kind: 'array', of: { kind: 'text' } },
    nullable: true,
  })
  s = addColumn(s, 'u', {
    id: 'u7',
    name: 'mood',
    type: { kind: 'user', typeId: 'e1' },
    nullable: true,
  })
  s = addColumn(s, 'u', {
    id: 'u8',
    name: 'code',
    type: { kind: 'char', length: 3 },
    nullable: true,
  })
  s = addColumn(s, 'u', {
    id: 'u9',
    name: 'ratio',
    type: { kind: 'double' },
    nullable: true,
  })
  s = setPrimaryKey(s, 'u', ['u1'])
  s = setTableComment(s, 'u', 'People')
  s = addIndex(s, 'u', {
    id: 'i1',
    name: 'uq_users_email',
    columns: ['u2'],
    unique: true,
    method: 'btree',
  })
  s = addIndex(s, 'u', {
    id: 'i2',
    name: 'idx_users_tags',
    columns: ['u6'],
    unique: false,
    method: 'gin',
  })
  s = addTable(s, { id: 'o', name: 'orders' })
  s = addColumn(s, 'o', {
    id: 'o1',
    name: 'id',
    type: { kind: 'uuid' },
    nullable: false,
    generated: true,
  })
  s = addColumn(s, 'o', {
    id: 'o2',
    name: 'user_id',
    type: { kind: 'integer' },
    nullable: false,
  })
  s = setPrimaryKey(s, 'o', ['o1'])
  s = addIndex(s, 'o', {
    id: 'i3',
    name: 'idx_orders_user',
    columns: ['o2'],
    unique: false,
    method: 'btree',
  })
  return addRelationship(s, {
    id: 'r',
    from: { tableId: 'o', columnId: 'o2' },
    to: { tableId: 'u', columnId: 'u1' },
  })
}

describe('importSql reads back what generateDdl writes', () => {
  it('gives the same schema, apart from ids', () => {
    const original = sample()
    const ddl = generateDdl(original, postgres)
    assert.equal(ddl.ok, true)
    if (!ddl.ok) return
    let counter = 0
    const result = importSql(ddl.sql, () => `x-${++counter}`)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(normalize(result.schema), normalize(original))
  })

  it('reads its own output a second time to the same DDL', () => {
    const first = generateDdl(sample(), postgres)
    assert.equal(first.ok, true)
    if (!first.ok) return
    let counter = 0
    const imported = importSql(first.sql, () => `y-${++counter}`)
    const second = generateDdl(imported.schema, postgres)
    assert.equal(second.ok, true)
    if (second.ok) assert.equal(second.sql, first.sql)
  })
})
