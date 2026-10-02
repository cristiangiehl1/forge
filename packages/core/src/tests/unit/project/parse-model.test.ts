import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseProject } from '../../../project/parse-project.ts'

const project = (schema: object) => ({ formatVersion: 1, schema, view: null })
const table = (
  extra: object = {},
  columns: object[] = [
    { id: 'c1', name: 'a', type: { kind: 'text' }, nullable: true },
  ]
) => ({
  id: 't',
  name: 'users',
  columns,
  primaryKey: [],
  ...extra,
})
const schema = (extra: object = {}, tables: object[] = [table()]) => ({
  version: 1,
  tables,
  relationships: [],
  ...extra,
})

describe('parseProject: a project saved before the new fields', () => {
  it('parses to the same shape, with no new keys', () => {
    const result = parseProject(project(schema()))
    assert.equal(result.ok, true)
    if (result.ok) {
      const parsed = result.project.schema
      assert.deepEqual(Object.keys(parsed).sort(), [
        'relationships',
        'tables',
        'version',
      ])
      assert.deepEqual(Object.keys(parsed.tables[0] ?? {}).sort(), [
        'columns',
        'id',
        'name',
        'primaryKey',
      ])
    }
  })
})

describe('parseProject: comments, defaults and indexes', () => {
  it('reads a table comment, a column comment and a column default', () => {
    const column = {
      id: 'c1',
      name: 'a',
      type: { kind: 'text' },
      nullable: true,
      comment: 'hi',
      default: "'x'",
    }
    const result = parseProject(
      project(schema({}, [table({ comment: 'People' }, [column])]))
    )
    assert.equal(result.ok, true)
    if (result.ok) {
      const parsed = result.project.schema.tables[0]
      assert.equal(parsed?.comment, 'People')
      assert.equal(parsed?.columns[0]?.comment, 'hi')
      assert.equal(parsed?.columns[0]?.default, "'x'")
    }
  })

  it('reads indexes', () => {
    const indexes = [
      { id: 'i1', name: 'idx_a', columns: ['c1'], unique: true, method: 'gin' },
    ]
    const result = parseProject(project(schema({}, [table({ indexes })])))
    assert.equal(result.ok, true)
    if (result.ok)
      assert.deepEqual(result.project.schema.tables[0]?.indexes, indexes)
  })

  it('rejects wrong types for them, with the path', () => {
    const bad = (extra: object, column: object = {}) =>
      parseProject(
        project(
          schema({}, [
            table(extra, [
              {
                id: 'c1',
                name: 'a',
                type: { kind: 'text' },
                nullable: true,
                ...column,
              },
            ]),
          ])
        )
      )
    const paths = (result: ReturnType<typeof parseProject>) =>
      result.ok ? [] : result.errors.map((error) => error.path)

    assert.ok(paths(bad({ comment: 3 })).includes('schema.tables[0].comment'))
    assert.ok(
      paths(bad({}, { comment: 3 })).includes(
        'schema.tables[0].columns[0].comment'
      )
    )
    assert.ok(
      paths(bad({}, { default: 3 })).includes(
        'schema.tables[0].columns[0].default'
      )
    )
    assert.ok(paths(bad({ indexes: 'x' })).includes('schema.tables[0].indexes'))
    assert.ok(
      paths(
        bad({
          indexes: [
            {
              id: 'i',
              name: 'n',
              columns: ['zz'],
              unique: false,
              method: 'btree',
            },
          ],
        })
      ).includes('schema.tables[0].indexes[0].columns[0]')
    )
    assert.ok(
      paths(
        bad({
          indexes: [
            {
              id: 'i',
              name: 'n',
              columns: ['c1'],
              unique: false,
              method: 'rtree',
            },
          ],
        })
      ).includes('schema.tables[0].indexes[0].method')
    )
  })
})

describe('parseProject: types', () => {
  const enumType = {
    kind: 'enum',
    id: 'e1',
    name: 'colour',
    values: ['red', 'green'],
  }
  const colourColumn = (type: object) => [
    { id: 'c1', name: 'a', type, nullable: true },
  ]

  it('reads enums and domains', () => {
    const domain = {
      kind: 'domain',
      id: 'd1',
      name: 'age',
      base: { kind: 'integer' },
      notNull: true,
      default: '0',
    }
    const result = parseProject(project(schema({ types: [enumType, domain] })))
    assert.equal(result.ok, true)
    if (result.ok)
      assert.deepEqual(result.project.schema.types, [enumType, domain])
  })

  it('reads char, array and user column types', () => {
    const types = [
      { kind: 'char', length: 3 },
      { kind: 'array', of: { kind: 'integer' } },
      { kind: 'array', of: { kind: 'user', typeId: 'e1' } },
      { kind: 'user', typeId: 'e1' },
      { kind: 'smallint' },
      { kind: 'timestamp_no_tz' },
      { kind: 'double' },
    ]
    for (const type of types) {
      const result = parseProject(
        project(schema({ types: [enumType] }, [table({}, colourColumn(type))]))
      )
      assert.equal(result.ok, true, JSON.stringify(type))
      if (result.ok)
        assert.deepEqual(
          result.project.schema.tables[0]?.columns[0]?.type,
          type
        )
    }
  })

  it('rejects a user type that does not exist, a bad char length and a bad array', () => {
    const fails = (type: object) =>
      !parseProject(
        project(schema({ types: [enumType] }, [table({}, colourColumn(type))]))
      ).ok
    assert.equal(fails({ kind: 'user', typeId: 'nope' }), true)
    assert.equal(fails({ kind: 'user' }), true)
    assert.equal(fails({ kind: 'char', length: 0 }), true)
    assert.equal(fails({ kind: 'array' }), true)
    assert.equal(
      fails({ kind: 'array', of: { kind: 'user', typeId: 'nope' } }),
      true
    )
  })

  it('rejects an invalid type entry with its path', () => {
    const result = parseProject(
      project(
        schema({ types: [{ kind: 'enum', id: 'e', name: 'n', values: [1] }] })
      )
    )
    assert.equal(result.ok, false)
    if (!result.ok)
      assert.ok(
        result.errors.some(
          (error) => error.path === 'schema.types[0].values[0]'
        )
      )
  })
})
