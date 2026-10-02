import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { summarizeErrors } from '../../../lib/notice.ts'

const errors = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    path: `p${index}`,
    message: 'm',
  }))

describe('summarizeErrors', () => {
  it('shows every error when there are few', () => {
    assert.deepEqual(summarizeErrors(errors(3), 5), {
      shown: errors(3),
      hidden: 0,
    })
  })

  it('shows the first ones and counts the rest', () => {
    const result = summarizeErrors(errors(8), 5)
    assert.equal(result.shown.length, 5)
    assert.equal(result.hidden, 3)
    assert.deepEqual(result.shown, errors(8).slice(0, 5))
  })

  it('handles exactly the limit and nothing at all', () => {
    assert.equal(summarizeErrors(errors(5), 5).hidden, 0)
    assert.deepEqual(summarizeErrors([], 5), { shown: [], hidden: 0 })
  })
})
