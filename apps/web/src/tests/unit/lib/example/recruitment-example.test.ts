import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { generateDdl, oracle, validate } from '@forge/core'

import { resolvePositions } from '../../../../lib/canvas/to-flow.ts'
import { createRecruitmentExample } from '../../../../lib/example/recruitment-example.ts'
import { RECRUITMENT_SQL } from '../../../../lib/example/recruitment-sql.ts'
import { routeRelationships } from '../../../../lib/routing/route-relationships.ts'

// Counted in RECRUITMENT_SQL: tables (CREATE TABLE at a line start) and REFERENCES.
const TABLES = 59
const REFERENCES = 75

describe('the recruitment example', () => {
  const example = createRecruitmentExample()

  it('reads every table and has no problem with the schema', () => {
    assert.equal(example.schema.tables.length, TABLES)
    assert.deepEqual(validate(example.schema), [])
    assert.ok(
      example.schema.tables.every(
        (table) => table.name === table.name.toUpperCase()
      )
    )
  })

  it('keeps the foreign keys Forge can model, and says what it left out', () => {
    assert.ok(example.schema.relationships.length > 0)
    assert.ok(example.schema.relationships.length <= REFERENCES)
    assert.ok(example.warnings.every((warning) => warning.line >= 1))
  })

  it('is laid out, with a position for every table and parents to the left', () => {
    assert.equal(Object.keys(example.view.nodes).length, TABLES)
    for (const relationship of example.schema.relationships.slice(0, 20)) {
      const parent = example.view.nodes[relationship.to.tableId]
      const child = example.view.nodes[relationship.from.tableId]
      if (relationship.to.tableId !== relationship.from.tableId) {
        assert.ok((parent?.x ?? 0) <= (child?.x ?? 0))
      }
    }
  })

  it('is deterministic', () => {
    assert.deepEqual(createRecruitmentExample().schema, example.schema)
  })

  it('writes an Oracle script', () => {
    const ddl = generateDdl(example.schema, oracle())
    assert.equal(
      ddl.ok,
      true,
      ddl.ok ? '' : JSON.stringify(ddl.issues.slice(0, 3))
    )
  })

  it('routes every line in a reasonable time', () => {
    const started = Date.now()
    const routes = routeRelationships(
      example.schema,
      resolvePositions(example.schema, example.view)
    )
    assert.equal(routes.size, example.schema.relationships.length)
    assert.ok(
      Date.now() - started < 5000,
      `routing took ${Date.now() - started} ms`
    )
  })

  it('is bundled as the SQL it was read from', () => {
    assert.ok(RECRUITMENT_SQL.includes('CREATE TABLE KONTRATA_JOBS'))
  })
})
