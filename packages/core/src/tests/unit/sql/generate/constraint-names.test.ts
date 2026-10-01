import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  byteLength,
  truncateToBytes,
  uniqueName,
} from '../../../../sql/generate/constraint-names.ts'

describe('byteLength', () => {
  it('counts UTF-8 bytes, not characters', () => {
    assert.equal(byteLength('abc'), 3)
    assert.equal(byteLength('ç'), 2)
    assert.equal(byteLength('€'), 3)
    assert.equal(byteLength('😀'), 4)
  })
})

describe('truncateToBytes', () => {
  it('returns the text unchanged when it fits', () => {
    assert.equal(truncateToBytes('abc', 3), 'abc')
  })

  it('cuts ASCII at the byte limit', () => {
    assert.equal(truncateToBytes('abcdef', 4), 'abcd')
  })

  it('never splits a multi-byte character', () => {
    assert.equal(truncateToBytes('ñññ', 5), 'ññ')
    assert.equal(truncateToBytes('😀😀', 5), '😀')
    assert.equal(truncateToBytes('😀', 3), '')
  })
})

describe('uniqueName', () => {
  it('returns the base and records it', () => {
    const used = new Set<string>()
    assert.equal(uniqueName('fk_a', used, 63), 'fk_a')
    assert.ok(used.has('fk_a'))
  })

  it('appends a numeric suffix on a collision', () => {
    const used = new Set<string>()
    assert.equal(uniqueName('fk_a', used, 63), 'fk_a')
    assert.equal(uniqueName('fk_a', used, 63), 'fk_a_2')
    assert.equal(uniqueName('fk_a', used, 63), 'fk_a_3')
  })

  it('keeps the suffixed name within the byte limit', () => {
    const used = new Set<string>()
    const long = 'x'.repeat(80)
    const first = uniqueName(long, used, 63)
    const second = uniqueName(long, used, 63)
    assert.equal(byteLength(first), 63)
    assert.equal(byteLength(second), 63)
    assert.ok(second.endsWith('_2'))
    assert.notEqual(first, second)
  })
})
