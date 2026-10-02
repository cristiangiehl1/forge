import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { sameTypeShape, userTypeIdsOf } from '../../../schema/type-shape.ts'

describe('sameTypeShape', () => {
  it('compares the kind, ignoring length, precision and scale', () => {
    assert.equal(
      sameTypeShape(
        { kind: 'varchar', length: 10 },
        { kind: 'varchar', length: 99 }
      ),
      true
    )
    assert.equal(sameTypeShape({ kind: 'integer' }, { kind: 'bigint' }), false)
  })

  it('compares the element of an array', () => {
    const ints = { kind: 'array', of: { kind: 'integer' } } as const
    assert.equal(
      sameTypeShape(ints, { kind: 'array', of: { kind: 'integer' } }),
      true
    )
    assert.equal(
      sameTypeShape(ints, { kind: 'array', of: { kind: 'text' } }),
      false
    )
    assert.equal(sameTypeShape(ints, { kind: 'integer' }), false)
  })

  it('compares the id of a user type', () => {
    assert.equal(
      sameTypeShape(
        { kind: 'user', typeId: 'a' },
        { kind: 'user', typeId: 'a' }
      ),
      true
    )
    assert.equal(
      sameTypeShape(
        { kind: 'user', typeId: 'a' },
        { kind: 'user', typeId: 'b' }
      ),
      false
    )
  })
})

describe('userTypeIdsOf', () => {
  it('finds a user type, also inside arrays', () => {
    assert.deepEqual(userTypeIdsOf({ kind: 'text' }), [])
    assert.deepEqual(userTypeIdsOf({ kind: 'user', typeId: 'a' }), ['a'])
    assert.deepEqual(
      userTypeIdsOf({ kind: 'array', of: { kind: 'user', typeId: 'a' } }),
      ['a']
    )
  })
})
