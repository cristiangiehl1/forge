import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseProject } from '../../../project/parse-project.ts'
import { createProject } from '../../../project/project.ts'
import { usersOrders } from '../../helpers/fixtures.ts'
import { column, schemaOf, table } from '../../helpers/schema-builders.ts'

const valid = () =>
  JSON.parse(JSON.stringify(createProject(usersOrders, { a: 1 })))

function errorPaths(input: unknown): string[] {
  const result = parseProject(input)
  assert.ok(!result.ok, 'expected a parse failure')
  return result.errors.map((error) => error.path)
}

// Errors are collected in document order, so the first one is the root cause;
// anything after it may be a consequence (a dropped column breaks the primary
// key and relationships that referred to it).
const firstErrorPath = (input: unknown) => errorPaths(input)[0]

describe('parseProject', () => {
  it('accepts a valid project and keeps the view', () => {
    const result = parseProject(valid())
    assert.ok(result.ok)
    assert.deepEqual(result.project.schema, usersOrders)
    assert.deepEqual(result.project.view, { a: 1 })
  })

  it('turns a missing view into null', () => {
    const input = valid()
    delete input.view
    const result = parseProject(input)
    assert.ok(result.ok)
    assert.equal(result.project.view, null)
  })

  it('accepts a draft with validation issues', () => {
    const draft = createProject(
      schemaOf([table('t', ''), table('u', '')]),
      null
    )
    assert.ok(parseProject(JSON.parse(JSON.stringify(draft))).ok)
  })

  it('rejects values that are not a project object', () => {
    for (const input of [null, undefined, 42, 'text', [], true]) {
      assert.equal(firstErrorPath(input), '')
    }
  })

  it('rejects an unknown or newer format version with a clear message', () => {
    const input = valid()
    input.formatVersion = 2
    const result = parseProject(input)
    assert.ok(!result.ok)
    assert.equal(result.errors[0]?.path, 'formatVersion')
    assert.match(result.errors[0]?.message ?? '', /version 2/)
  })

  it('rejects a schema of an unsupported version or shape', () => {
    const wrongVersion = valid()
    wrongVersion.schema.version = 9
    assert.equal(firstErrorPath(wrongVersion), 'schema.version')

    const noTables = valid()
    delete noTables.schema.tables
    assert.equal(firstErrorPath(noTables), 'schema.tables')
  })

  it('rejects a relationship that points at a missing table or column', () => {
    const missingTable = valid()
    missingTable.schema.relationships[0].to.tableId = 'gone'
    assert.equal(firstErrorPath(missingTable), 'schema.relationships[0].to')

    const missingColumn = valid()
    missingColumn.schema.relationships[0].from.columnId = 'gone'
    assert.equal(firstErrorPath(missingColumn), 'schema.relationships[0].from')
  })

  it('rejects a primary key that names a missing column', () => {
    const input = valid()
    input.schema.tables[0].primaryKey = ['gone']
    assert.equal(firstErrorPath(input), 'schema.tables[0].primaryKey[0]')
  })

  it('rejects duplicate ids', () => {
    const tables = valid()
    tables.schema.tables[1].id = 'users'
    assert.equal(firstErrorPath(tables), 'schema.tables[1].id')

    const columns = valid()
    columns.schema.tables[0].columns[1].id = 'u_id'
    assert.equal(firstErrorPath(columns), 'schema.tables[0].columns[1].id')
  })

  it('rejects invalid column types', () => {
    const cases: unknown[] = [
      { kind: 'nope' },
      { kind: 'varchar' },
      { kind: 'varchar', length: 0 },
      { kind: 'varchar', length: 1.5 },
      { kind: 'varchar', length: 10485761 },
      { kind: 'numeric', precision: 5 },
      { kind: 'numeric', precision: 5, scale: 6 },
      { kind: 'numeric', precision: 1001, scale: 0 },
      'text',
      null,
    ]
    for (const type of cases) {
      const input = valid()
      input.schema.tables[0].columns[0].type = type
      assert.equal(firstErrorPath(input), 'schema.tables[0].columns[0].type')
    }
  })

  it('rejects a column with a wrong field type', () => {
    const input = valid()
    input.schema.tables[0].columns[0].nullable = 'no'
    assert.equal(firstErrorPath(input), 'schema.tables[0].columns[0].nullable')
  })

  it('reports every problem, not just the first', () => {
    const input = valid()
    input.schema.tables[0].primaryKey = ['gone']
    input.schema.relationships[0].to.tableId = 'gone'
    assert.equal(errorPaths(input).length, 2)
  })

  it('accepts every logical type', () => {
    const everyType = schemaOf([
      table('t', 't', [
        column('a', 'a', { kind: 'integer' }),
        column('b', 'b', { kind: 'varchar', length: 10485760 }),
        column('c', 'c', { kind: 'numeric', precision: 1000, scale: 1000 }),
      ]),
    ])
    assert.ok(
      parseProject(JSON.parse(JSON.stringify(createProject(everyType, null))))
        .ok
    )
  })
})
