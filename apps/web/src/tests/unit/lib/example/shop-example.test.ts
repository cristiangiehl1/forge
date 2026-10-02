import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createProject,
  generateDdl,
  parseProject,
  postgres,
  validate,
} from '@forge/core'

import { createShopExample } from '../../../../lib/example/shop-example.ts'

describe('createShopExample', () => {
  const { schema, view } = createShopExample()

  it('has at least six tables', () => {
    assert.ok(schema.tables.length >= 6, `${schema.tables.length} tables`)
  })

  it('has at least two tables that hold a foreign key', () => {
    const holders = new Set(schema.relationships.map((r) => r.from.tableId))
    assert.ok(holders.size >= 2, `${holders.size} tables with a foreign key`)
    assert.ok(schema.relationships.length >= 2)
  })

  it('is a valid schema that generates DDL', () => {
    assert.deepEqual(validate(schema), [])
    const result = generateDdl(schema, postgres)
    assert.ok(result.ok)
    assert.equal(
      (result.sql.match(/CREATE TABLE/g) ?? []).length,
      schema.tables.length
    )
    assert.equal(
      (result.sql.match(/FOREIGN KEY/g) ?? []).length,
      schema.relationships.length
    )
    assert.ok(
      !result.sql.includes('ALTER TABLE'),
      'no cycle, so no ALTER TABLE'
    )
  })

  it('gives every table a position of its own', () => {
    const positions = schema.tables.map((table) => view.nodes[table.id])
    assert.ok(positions.every((position) => position !== undefined))
    assert.equal(
      new Set(positions.map((p) => `${p?.x},${p?.y}`)).size,
      schema.tables.length,
      'two tables share a position'
    )
  })

  it('uses unique ids', () => {
    const ids = [
      ...schema.tables.map((table) => table.id),
      ...schema.tables.flatMap((table) => table.columns.map((c) => c.id)),
      ...schema.relationships.map((r) => r.id),
    ]
    assert.equal(new Set(ids).size, ids.length)
  })

  it('gives every created_at column DEFAULT now(), as the timestamps preference does', () => {
    const created = schema.tables.flatMap((table) =>
      table.columns.filter((column) => column.name === 'created_at')
    )
    assert.ok(created.length > 0)
    for (const column of created) assert.equal(column.generated, true)
  })

  it('shows what the app can do: generated ids, a composite key, several types', () => {
    const columns = schema.tables.flatMap((table) => table.columns)
    assert.ok(
      columns.some((c) => c.generated === true && c.type.kind === 'integer')
    )
    assert.ok(schema.tables.some((table) => table.primaryKey.length > 1))
    const kinds = new Set(columns.map((c) => c.type.kind))
    for (const kind of [
      'integer',
      'varchar',
      'numeric',
      'timestamp',
      'boolean',
      'text',
    ]) {
      assert.ok(kinds.has(kind as never), `no ${kind} column`)
    }
  })

  it('is deterministic: two calls give the same project', () => {
    assert.deepEqual(createShopExample(), createShopExample())
  })

  it('survives being saved and loaded', () => {
    const stored = JSON.stringify(createProject(schema, view))
    const parsed = parseProject(JSON.parse(stored))
    assert.ok(parsed.ok)
    assert.deepEqual(parsed.project.schema, schema)
  })
})

describe('the layout of the example', () => {
  it('puts every referenced table to the left of the tables that reference it', () => {
    const { schema, view } = createShopExample()
    for (const relationship of schema.relationships) {
      const child = view.nodes[relationship.from.tableId]
      const parent = view.nodes[relationship.to.tableId]
      assert.ok(
        (parent?.x ?? 0) < (child?.x ?? 0),
        `${relationship.id}: the parent is not on the left`
      )
    }
  })
})
