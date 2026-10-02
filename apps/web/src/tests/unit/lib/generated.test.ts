import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Column, ColumnType } from '@forge/core'

import {
  impliesNotNull,
  showsGeneratedToggle,
  supportsGenerated,
  typeChangePatch,
} from '../../../lib/generated.ts'

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

describe('impliesNotNull', () => {
  it('is true for a generated integer or bigint: PostgreSQL makes identity NOT NULL', () => {
    assert.equal(impliesNotNull(column({ kind: 'integer' }, true)), true)
    assert.equal(impliesNotNull(column({ kind: 'bigint' }, true)), true)
  })

  it('is false for a generated uuid, and for any column that is not generated', () => {
    assert.equal(impliesNotNull(column({ kind: 'uuid' }, true)), false)
    assert.equal(impliesNotNull(column({ kind: 'integer' })), false)
    assert.equal(impliesNotNull(column({ kind: 'integer' }, false)), false)
  })

  it('is false for a generated column of a type that cannot be generated', () => {
    assert.equal(impliesNotNull(column({ kind: 'text' }, true)), false)
  })
})

describe('showsGeneratedToggle', () => {
  it('is shown for the types that can be generated', () => {
    assert.equal(showsGeneratedToggle(column({ kind: 'integer' })), true)
    assert.equal(showsGeneratedToggle(column({ kind: 'uuid' }, false)), true)
  })

  it('is hidden for other types', () => {
    assert.equal(showsGeneratedToggle(column({ kind: 'text' })), false)
    assert.equal(showsGeneratedToggle(column({ kind: 'text' }, false)), false)
  })

  it('is shown for a column that is generated on a type that cannot be, so it can be cleared', () => {
    assert.equal(showsGeneratedToggle(column({ kind: 'text' }, true)), true)
  })
})
