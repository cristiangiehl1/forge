import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { importSql } from '../../../sql/parse/import-sql.ts'

describe('importSql on a large script', () => {
  it('stays fast: thousands of tables with keys, indexes and foreign keys', () => {
    const count = 8000
    const lines: string[] = []
    for (let i = 0; i < count; i++) {
      lines.push(`CREATE TABLE t${i} (id int, p int);`)
      lines.push(
        `ALTER TABLE ONLY t${i} ADD CONSTRAINT t${i}_pkey PRIMARY KEY (id);`
      )
      lines.push(`CREATE INDEX i${i} ON t${i} (p);`)
      if (i > 0) {
        lines.push(
          `ALTER TABLE t${i} ADD FOREIGN KEY (p) REFERENCES t${i - 1} (id);`
        )
      }
    }
    let counter = 0
    const started = Date.now()
    const result = importSql(lines.join('\n'), () => `id-${++counter}`)
    const elapsed = Date.now() - started
    assert.deepEqual(result.errors, [])
    assert.equal(result.schema.tables.length, count)
    assert.equal(result.schema.relationships.length, count - 1)
    assert.ok(elapsed < 3000, `took ${elapsed} ms`)
  })
})
