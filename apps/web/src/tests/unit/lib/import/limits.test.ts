import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  describeLimit,
  MAX_SQL_BYTES,
  tooBig,
} from '../../../../lib/import/limits.ts'

describe('the size limit', () => {
  it('is 1 MB, and a size over it is too big', () => {
    assert.equal(MAX_SQL_BYTES, 1024 * 1024)
    assert.equal(describeLimit(), '1 MB')
    assert.equal(tooBig(MAX_SQL_BYTES), false)
    assert.equal(tooBig(MAX_SQL_BYTES + 1), true)
    assert.equal(tooBig(0), false)
  })
})
