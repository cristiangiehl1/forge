import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseDraft } from '../../../lib/number-draft.ts'

describe('parseDraft', () => {
  it('reads an integer inside the range', () => {
    assert.equal(parseDraft('120', 1, 1000), 120)
    assert.equal(parseDraft('1', 1, 1000), 1)
    assert.equal(parseDraft('1000', 1, 1000), 1000)
    assert.equal(parseDraft(' 7 ', 1, 10), 7)
  })

  it('is null while the text is not a usable number yet', () => {
    for (const text of ['', ' ', '-', 'abc', '1e', '1.5', '0x10', 'Infinity']) {
      assert.equal(parseDraft(text, 1, 1000), null, text)
    }
  })

  it('is null outside the range, so typing a 0 first does not become a 1', () => {
    assert.equal(parseDraft('0', 1, 1000), null)
    assert.equal(parseDraft('1001', 1, 1000), null)
    assert.equal(parseDraft('-5', 0, 10), null)
  })

  it('accepts zero when the range starts there', () => {
    assert.equal(parseDraft('0', 0, 10), 0)
  })
})
