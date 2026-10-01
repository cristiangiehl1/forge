import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../dialects/postgres.ts'
import type { ColumnType } from '../../../schema/types.ts'

describe('postgres.typeName', () => {
  const cases: [ColumnType, string][] = [
    [{ kind: 'integer' }, 'integer'],
    [{ kind: 'bigint' }, 'bigint'],
    [{ kind: 'text' }, 'text'],
    [{ kind: 'boolean' }, 'boolean'],
    [{ kind: 'uuid' }, 'uuid'],
    [{ kind: 'date' }, 'date'],
    [{ kind: 'timestamp' }, 'timestamptz'],
    [{ kind: 'json' }, 'jsonb'],
    [{ kind: 'varchar', length: 120 }, 'varchar(120)'],
    [{ kind: 'numeric', precision: 10, scale: 2 }, 'numeric(10,2)'],
  ]

  for (const [type, expected] of cases) {
    it(`maps ${JSON.stringify(type)} to ${expected}`, () => {
      assert.equal(postgres.typeName(type), expected)
    })
  }
})

describe('postgres.quoteIdentifier', () => {
  it('wraps the name in double quotes', () => {
    assert.equal(postgres.quoteIdentifier('users'), '"users"')
  })

  it('preserves case and spaces', () => {
    assert.equal(postgres.quoteIdentifier('Order Items'), '"Order Items"')
  })

  it('escapes embedded double quotes by doubling them', () => {
    assert.equal(postgres.quoteIdentifier('a"b'), '"a""b"')
    assert.equal(postgres.quoteIdentifier('"'), '""""')
  })

  it('keeps non-ASCII characters', () => {
    assert.equal(postgres.quoteIdentifier('coluna_ção'), '"coluna_ção"')
  })
})

describe('postgres metadata', () => {
  it('declares its id and identifier limit', () => {
    assert.equal(postgres.id, 'postgres')
    assert.equal(postgres.maxIdentifierBytes, 63)
  })
})
