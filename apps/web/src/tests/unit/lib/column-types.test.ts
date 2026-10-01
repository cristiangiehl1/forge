import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MAX_NUMERIC_PRECISION, MAX_VARCHAR_LENGTH } from '@forge/core'

import {
  COLUMN_KINDS,
  defaultColumnType,
  formatColumnType,
  setNumericPrecision,
  setNumericScale,
  setVarcharLength,
} from '../../../lib/column-types.ts'

describe('COLUMN_KINDS', () => {
  it('lists the simple kinds, then varchar and numeric', () => {
    assert.deepEqual(
      [...COLUMN_KINDS],
      [
        'integer',
        'bigint',
        'text',
        'boolean',
        'uuid',
        'timestamp',
        'date',
        'json',
        'varchar',
        'numeric',
      ]
    )
  })
})

describe('defaultColumnType', () => {
  it('returns a parameterless type for simple kinds', () => {
    assert.deepEqual(defaultColumnType('uuid'), { kind: 'uuid' })
  })

  it('returns usable defaults for varchar and numeric', () => {
    assert.deepEqual(defaultColumnType('varchar'), {
      kind: 'varchar',
      length: 255,
    })
    assert.deepEqual(defaultColumnType('numeric'), {
      kind: 'numeric',
      precision: 10,
      scale: 2,
    })
  })
})

describe('formatColumnType', () => {
  it('formats parameterized and simple types', () => {
    assert.equal(
      formatColumnType({ kind: 'varchar', length: 120 }),
      'varchar(120)'
    )
    assert.equal(
      formatColumnType({ kind: 'numeric', precision: 10, scale: 2 }),
      'numeric(10,2)'
    )
    assert.equal(formatColumnType({ kind: 'timestamp' }), 'timestamp')
  })
})

describe('setVarcharLength', () => {
  const type = { kind: 'varchar', length: 50 } as const

  it('sets a valid length', () => {
    assert.deepEqual(setVarcharLength(type, 120), {
      kind: 'varchar',
      length: 120,
    })
  })

  it('truncates and clamps to the valid range', () => {
    assert.deepEqual(setVarcharLength(type, 12.7), {
      kind: 'varchar',
      length: 12,
    })
    assert.deepEqual(setVarcharLength(type, 0), { kind: 'varchar', length: 1 })
    assert.deepEqual(setVarcharLength(type, -5), { kind: 'varchar', length: 1 })
    assert.deepEqual(setVarcharLength(type, MAX_VARCHAR_LENGTH + 1), {
      kind: 'varchar',
      length: MAX_VARCHAR_LENGTH,
    })
    assert.deepEqual(setVarcharLength(type, Number.NaN), {
      kind: 'varchar',
      length: 1,
    })
  })

  it('leaves a type of another kind untouched', () => {
    const other = { kind: 'text' } as const
    assert.equal(setVarcharLength(other, 10), other)
  })
})

describe('setNumericPrecision', () => {
  const type = { kind: 'numeric', precision: 10, scale: 4 } as const

  it('sets the precision and keeps the scale when it still fits', () => {
    assert.deepEqual(setNumericPrecision(type, 12), {
      kind: 'numeric',
      precision: 12,
      scale: 4,
    })
  })

  it('lowers the scale together with the precision', () => {
    assert.deepEqual(setNumericPrecision(type, 3), {
      kind: 'numeric',
      precision: 3,
      scale: 3,
    })
  })

  it('clamps to the valid range', () => {
    assert.deepEqual(setNumericPrecision(type, 0), {
      kind: 'numeric',
      precision: 1,
      scale: 1,
    })
    assert.deepEqual(setNumericPrecision(type, MAX_NUMERIC_PRECISION + 1), {
      kind: 'numeric',
      precision: MAX_NUMERIC_PRECISION,
      scale: 4,
    })
  })

  it('leaves a type of another kind untouched', () => {
    const other = { kind: 'integer' } as const
    assert.equal(setNumericPrecision(other, 5), other)
  })
})

describe('setNumericScale', () => {
  const type = { kind: 'numeric', precision: 10, scale: 2 } as const

  it('sets a valid scale', () => {
    assert.deepEqual(setNumericScale(type, 5), {
      kind: 'numeric',
      precision: 10,
      scale: 5,
    })
  })

  it('clamps between zero and the precision', () => {
    assert.deepEqual(setNumericScale(type, -1), {
      kind: 'numeric',
      precision: 10,
      scale: 0,
    })
    assert.deepEqual(setNumericScale(type, 99), {
      kind: 'numeric',
      precision: 10,
      scale: 10,
    })
  })

  it('leaves a type of another kind untouched', () => {
    const other = { kind: 'text' } as const
    assert.equal(setNumericScale(other, 1), other)
  })
})
