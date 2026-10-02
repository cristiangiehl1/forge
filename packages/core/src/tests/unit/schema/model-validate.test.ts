import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type {
  Column,
  ColumnType,
  Schema,
  Table,
  UserType,
} from '../../../schema/types.ts'
import { validate } from '../../../schema/validate.ts'

const col = (
  id: string,
  name: string,
  type: ColumnType = { kind: 'text' }
): Column => ({
  id,
  name,
  type,
  nullable: true,
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
const codes = (schema: Schema) => validate(schema).map((issue) => issue.code)

describe('validate: a schema without the new fields', () => {
  it('is valid, as every project saved before them is', () => {
    assert.deepEqual(
      validate(schemaOf([tbl('t', 'users', [col('c', 'id')])])),
      []
    )
  })
})

describe('validate: default', () => {
  it('flags a column that is both generated and has a default', () => {
    const column = {
      ...col('c', 'id', { kind: 'integer' }),
      generated: true,
      default: '0',
    }
    assert.deepEqual(codes(schemaOf([tbl('t', 'users', [column])])), [
      'generated-with-default',
    ])
  })

  it('allows a default on its own, and an empty default next to generated', () => {
    const plain = { ...col('c', 'n', { kind: 'integer' }), default: '0' }
    const blank = {
      ...col('d', 'id', { kind: 'integer' }),
      generated: true,
      default: '',
    }
    assert.deepEqual(codes(schemaOf([tbl('t', 'users', [plain, blank])])), [])
  })
})

describe('validate: indexes', () => {
  const index = (over: object = {}) => ({
    id: 'i1',
    name: 'idx_a',
    columns: ['c1'],
    unique: false,
    method: 'btree' as const,
    ...over,
  })
  const withIndexes = (...indexes: ReturnType<typeof index>[]) =>
    schemaOf([tbl('t', 'users', [col('c1', 'a'), col('c2', 'b')], { indexes })])

  it('accepts a normal index', () => {
    assert.deepEqual(codes(withIndexes(index())), [])
  })

  it('flags an empty name, no columns, an unknown column and a repeated column', () => {
    assert.deepEqual(codes(withIndexes(index({ name: ' ' }))), [
      'empty-index-name',
    ])
    assert.deepEqual(codes(withIndexes(index({ columns: [] }))), [
      'index-without-columns',
    ])
    assert.deepEqual(codes(withIndexes(index({ columns: ['zz'] }))), [
      'index-unknown-column',
    ])
    assert.deepEqual(codes(withIndexes(index({ columns: ['c1', 'c1'] }))), [
      'index-duplicate-column',
    ])
  })

  it('flags a name used twice, across tables too', () => {
    assert.deepEqual(codes(withIndexes(index(), index({ id: 'i2' }))), [
      'duplicate-index-name',
    ])
    const across = schemaOf([
      tbl('t', 'a', [col('c1', 'x')], { indexes: [index()] }),
      tbl('u', 'b', [col('c1', 'x')], { indexes: [index({ id: 'i2' })] }),
    ])
    assert.deepEqual(codes(across), ['duplicate-index-name'])
  })

  it('reports the table and the index', () => {
    const [found] = validate(withIndexes(index({ columns: [] })))
    assert.equal(found?.tableId, 't')
    assert.equal(found?.indexId, 'i1')
  })
})

describe('validate: user types', () => {
  const colour: UserType = {
    kind: 'enum',
    id: 'e1',
    name: 'colour',
    values: ['red', 'green'],
  }

  it('accepts an enum and a column that uses it, also inside an array', () => {
    const used = col('c', 'c', { kind: 'user', typeId: 'e1' })
    const many = col('d', 'd', {
      kind: 'array',
      of: { kind: 'user', typeId: 'e1' },
    })
    assert.deepEqual(
      codes(schemaOf([tbl('t', 'x', [used, many])], [colour])),
      []
    )
  })

  it('flags a column whose type does not exist', () => {
    const lost = col('c', 'c', { kind: 'user', typeId: 'nope' })
    assert.deepEqual(codes(schemaOf([tbl('t', 'x', [lost])], [colour])), [
      'unknown-type',
    ])
    assert.deepEqual(codes(schemaOf([tbl('t', 'x', [lost])])), ['unknown-type'])
  })

  it('flags an empty or repeated type name', () => {
    assert.deepEqual(codes(schemaOf([], [{ ...colour, name: '' }])), [
      'empty-type-name',
    ])
    assert.deepEqual(codes(schemaOf([], [colour, { ...colour, id: 'e2' }])), [
      'duplicate-type-name',
    ])
  })

  it('flags an enum with no values, an empty value, or a repeated value', () => {
    assert.deepEqual(codes(schemaOf([], [{ ...colour, values: [] }])), [
      'enum-without-values',
    ])
    assert.deepEqual(codes(schemaOf([], [{ ...colour, values: ['a', ''] }])), [
      'enum-empty-value',
    ])
    assert.deepEqual(codes(schemaOf([], [{ ...colour, values: ['a', 'a'] }])), [
      'enum-duplicate-value',
    ])
  })

  it('flags a domain whose base type does not exist', () => {
    const domain: UserType = {
      kind: 'domain',
      id: 'd1',
      name: 'age',
      base: { kind: 'user', typeId: 'zz' },
    }
    assert.deepEqual(codes(schemaOf([], [domain])), ['unknown-type'])
  })
})

describe('validate: relationships between user types', () => {
  const enumA: UserType = { kind: 'enum', id: 'a', name: 'a', values: ['x'] }
  const enumB: UserType = { kind: 'enum', id: 'b', name: 'b', values: ['x'] }
  const build = (from: ColumnType, to: ColumnType): Schema => ({
    ...schemaOf(
      [
        {
          id: 't1',
          name: 'child',
          columns: [col('c1', 'k', from)],
          primaryKey: [],
        },
        {
          id: 't2',
          name: 'parent',
          columns: [col('c2', 'k', to)],
          primaryKey: ['c2'],
        },
      ],
      [enumA, enumB]
    ),
    relationships: [
      {
        id: 'r',
        from: { tableId: 't1', columnId: 'c1' },
        to: { tableId: 't2', columnId: 'c2' },
      },
    ],
  })

  it('accepts the same user type and flags two different ones with equal values', () => {
    assert.deepEqual(
      codes(
        build({ kind: 'user', typeId: 'a' }, { kind: 'user', typeId: 'a' })
      ),
      []
    )
    assert.deepEqual(
      codes(
        build({ kind: 'user', typeId: 'a' }, { kind: 'user', typeId: 'b' })
      ),
      ['relationship-type-mismatch']
    )
  })
})

describe('validate: domain cycles', () => {
  const domain = (id: string, base: string): UserType => ({
    kind: 'domain',
    id,
    name: id,
    base: { kind: 'user', typeId: base },
  })

  it('flags a domain based on itself and two domains based on each other', () => {
    assert.deepEqual(codes(schemaOf([], [domain('a', 'a')])), ['type-cycle'])
    assert.deepEqual(
      codes(schemaOf([], [domain('a', 'b'), domain('b', 'a')])),
      ['type-cycle', 'type-cycle']
    )
  })

  it('accepts a chain of domains that ends', () => {
    const base: UserType = {
      kind: 'domain',
      id: 'c',
      name: 'c',
      base: { kind: 'text' },
    }
    assert.deepEqual(
      codes(schemaOf([], [domain('a', 'b'), domain('b', 'c'), base])),
      []
    )
  })
})

describe('validate: names that share a namespace', () => {
  const col = (id: string, name: string): Column => ({
    id,
    name,
    type: { kind: 'text' },
    nullable: true,
  })

  it('flags an index named like a table, and a type named like a table', () => {
    const indexNamedLikeTable = schemaOf([
      {
        id: 't1',
        name: 'users',
        columns: [col('c', 'a')],
        primaryKey: [],
        indexes: [
          {
            id: 'i',
            name: 'orders',
            columns: ['c'],
            unique: false,
            method: 'btree',
          },
        ],
      },
      { id: 't2', name: 'orders', columns: [], primaryKey: [] },
    ])
    assert.deepEqual(codes(indexNamedLikeTable), ['name-collision'])

    const typeNamedLikeTable = schemaOf(
      [{ id: 't', name: 'status', columns: [], primaryKey: [] }],
      [{ kind: 'enum', id: 'e', name: 'status', values: ['a'] }]
    )
    assert.deepEqual(codes(typeNamedLikeTable), ['name-collision'])
  })

  it('does not flag an index and a type that share a name, nor unrelated names', () => {
    const fine = schemaOf(
      [
        {
          id: 't',
          name: 'users',
          columns: [col('c', 'a')],
          primaryKey: [],
          indexes: [
            {
              id: 'i',
              name: 'status',
              columns: ['c'],
              unique: false,
              method: 'btree',
            },
          ],
        },
      ],
      [{ kind: 'enum', id: 'e', name: 'status', values: ['a'] }]
    )
    assert.deepEqual(codes(fine), [])
  })
})

describe('validate: the message for two types that differ', () => {
  it('names the user types and shows arrays, instead of "user"', () => {
    const enumA: UserType = {
      kind: 'enum',
      id: 'a',
      name: 'colour',
      values: ['x'],
    }
    const enumB: UserType = {
      kind: 'enum',
      id: 'b',
      name: 'shape',
      values: ['x'],
    }
    const column = (id: string, type: ColumnType): Column => ({
      id,
      name: 'k',
      type,
      nullable: true,
    })
    const schema: Schema = {
      ...schemaOf(
        [
          {
            id: 't1',
            name: 'child',
            columns: [column('c1', { kind: 'user', typeId: 'a' })],
            primaryKey: [],
          },
          {
            id: 't2',
            name: 'parent',
            columns: [
              column('c2', {
                kind: 'array',
                of: { kind: 'user', typeId: 'b' },
              }),
            ],
            primaryKey: ['c2'],
          },
        ],
        [enumA, enumB]
      ),
      relationships: [
        {
          id: 'r',
          from: { tableId: 't1', columnId: 'c1' },
          to: { tableId: 't2', columnId: 'c2' },
        },
      ],
    }
    const [issue] = validate(schema)
    assert.equal(issue?.code, 'relationship-type-mismatch')
    assert.ok(issue?.message.includes('(colour)'), issue?.message)
    assert.ok(issue?.message.includes('(shape[])'), issue?.message)
  })
})
