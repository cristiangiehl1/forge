import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Column, ColumnType } from '@forge/core'

import { supportsGenerated, typeChangePatch } from '../../../lib/generated.ts'

const column = (type: ColumnType, generated?: boolean): Column => ({
  id: 'c',
  name: 'c',
  type,
  nullable: false,
  ...(generated === undefined ? {} : { generated }),
})

describe('supportsGenerated', () => {
  it('is true for the types the database can generate', () => {
    for (const kind of ['integer', 'bigint', 'uuid'] as const) {
      assert.equal(supportsGenerated({ kind }), true)
    }
  })

  it('is false for every other type', () => {
    assert.equal(supportsGenerated({ kind: 'text' }), false)
    assert.equal(supportsGenerated({ kind: 'boolean' }), false)
    assert.equal(supportsGenerated({ kind: 'varchar', length: 10 }), false)
    assert.equal(
      supportsGenerated({ kind: 'numeric', precision: 5, scale: 2 }),
      false
    )
  })
})

describe('typeChangePatch', () => {
  it('keeps a generated column generated when the new type supports it', () => {
    assert.deepEqual(
      typeChangePatch(column({ kind: 'integer' }, true), 'uuid'),
      {
        type: { kind: 'uuid' },
      }
    )
  })

  it('clears the flag when the new type cannot be generated', () => {
    assert.deepEqual(
      typeChangePatch(column({ kind: 'integer' }, true), 'text'),
      {
        type: { kind: 'text' },
        generated: false,
      }
    )
    assert.deepEqual(
      typeChangePatch(column({ kind: 'uuid' }, true), 'varchar'),
      { type: { kind: 'varchar', length: 255 }, generated: false }
    )
  })

  it('only changes the type of a column that was not generated', () => {
    assert.deepEqual(typeChangePatch(column({ kind: 'text' }), 'varchar'), {
      type: { kind: 'varchar', length: 255 },
    })
    assert.deepEqual(
      typeChangePatch(column({ kind: 'integer' }, false), 'text'),
      {
        type: { kind: 'text' },
      }
    )
  })
})
