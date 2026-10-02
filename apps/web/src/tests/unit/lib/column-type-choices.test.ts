import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ColumnType } from '@forge/core'

import {
  baseType,
  choiceOf,
  defaultColumnType,
  formatColumnType,
  kindLabel,
  mapBase,
  typeFromChoice,
  withArray,
} from '../../../lib/column-types.ts'

describe('defaultColumnType and kindLabel', () => {
  it('gives char a length of 1', () => {
    assert.deepEqual(defaultColumnType('char'), { kind: 'char', length: 1 })
  })

  it('labels the kinds a person would not guess from the identifier', () => {
    assert.equal(kindLabel('timestamp_no_tz'), 'timestamp (no tz)')
    assert.equal(kindLabel('double'), 'double precision')
    assert.equal(kindLabel('integer'), 'integer')
  })
})

describe('formatColumnType: the new kinds', () => {
  const names = (id: string) => (id === 'e1' ? 'mood' : '?')
  it('writes char, arrays and user types', () => {
    assert.equal(formatColumnType({ kind: 'char', length: 3 }), 'char(3)')
    assert.equal(
      formatColumnType({ kind: 'array', of: { kind: 'integer' } }),
      'integer[]'
    )
    assert.equal(
      formatColumnType({ kind: 'user', typeId: 'e1' }, names),
      'mood'
    )
    assert.equal(
      formatColumnType(
        { kind: 'array', of: { kind: 'user', typeId: 'e1' } },
        names
      ),
      'mood[]'
    )
    assert.equal(
      formatColumnType({ kind: 'timestamp_no_tz' }),
      'timestamp (no tz)'
    )
  })
})

describe('array and choice helpers', () => {
  const ints: ColumnType = { kind: 'array', of: { kind: 'integer' } }

  it('baseType and mapBase see through an array', () => {
    assert.deepEqual(baseType(ints), { kind: 'integer' })
    assert.deepEqual(baseType({ kind: 'text' }), { kind: 'text' })
    assert.deepEqual(
      mapBase({ kind: 'array', of: { kind: 'varchar', length: 5 } }, () => ({
        kind: 'text',
      })),
      { kind: 'array', of: { kind: 'text' } }
    )
    assert.deepEqual(
      mapBase({ kind: 'integer' }, () => ({ kind: 'text' })),
      { kind: 'text' }
    )
  })

  it('withArray wraps and unwraps, and is idempotent', () => {
    assert.deepEqual(withArray({ kind: 'integer' }, true), ints)
    assert.deepEqual(withArray(ints, true), ints)
    assert.deepEqual(withArray(ints, false), { kind: 'integer' })
    assert.deepEqual(withArray({ kind: 'integer' }, false), { kind: 'integer' })
  })

  it('choiceOf names the kind, or the user type, of the element', () => {
    assert.equal(choiceOf({ kind: 'varchar', length: 9 }), 'varchar')
    assert.equal(choiceOf(ints), 'integer')
    assert.equal(choiceOf({ kind: 'user', typeId: 'e1' }), 'user:e1')
    assert.equal(
      choiceOf({ kind: 'array', of: { kind: 'user', typeId: 'e1' } }),
      'user:e1'
    )
  })

  it('typeFromChoice builds the type, optionally as an array', () => {
    assert.deepEqual(typeFromChoice('varchar', false), {
      kind: 'varchar',
      length: 255,
    })
    assert.deepEqual(typeFromChoice('user:e1', false), {
      kind: 'user',
      typeId: 'e1',
    })
    assert.deepEqual(typeFromChoice('user:e1', true), {
      kind: 'array',
      of: { kind: 'user', typeId: 'e1' },
    })
  })
})
