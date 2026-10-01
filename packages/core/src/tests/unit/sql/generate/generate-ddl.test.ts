import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../../dialects/postgres.ts'
import { generateDdl } from '../../../../sql/generate/generate-ddl.ts'
import { schemaOf, table } from '../../../helpers/schema-builders.ts'

describe('generateDdl', () => {
  it('returns the validation issues and no SQL for an invalid schema', () => {
    const result = generateDdl(schemaOf([table('t', '')]), postgres)
    assert.ok(!result.ok)
    assert.equal(result.issues[0]?.code, 'empty-table-name')
  })

  it('returns an empty string for an empty schema', () => {
    assert.deepEqual(generateDdl(schemaOf([]), postgres), {
      ok: true,
      sql: '',
    })
  })
})
