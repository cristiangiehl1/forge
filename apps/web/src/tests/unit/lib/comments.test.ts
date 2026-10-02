import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hasComment } from '../../../lib/comments.ts'

describe('hasComment', () => {
  it('is true only for text that is not blank', () => {
    assert.equal(hasComment('Login address'), true)
    assert.equal(hasComment(''), false)
    assert.equal(hasComment('   '), false)
    assert.equal(hasComment(undefined), false)
  })
})
