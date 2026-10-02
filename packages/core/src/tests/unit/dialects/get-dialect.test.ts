import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getDialect } from '../../../dialects/get-dialect.ts'
import { postgres } from '../../../dialects/postgres.ts'

describe('getDialect', () => {
  it('gives PostgreSQL, and Oracle with its options', () => {
    assert.equal(getDialect('postgres'), postgres)
    assert.equal(getDialect('oracle').id, 'oracle')
    assert.equal(
      getDialect('oracle', { uuid: 'varchar36' }).typeName({ kind: 'uuid' }),
      'VARCHAR2(36)'
    )
    assert.equal(getDialect('oracle').typeName({ kind: 'uuid' }), 'RAW(16)')
  })
})
