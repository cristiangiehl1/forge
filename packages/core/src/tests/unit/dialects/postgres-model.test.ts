import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../dialects/postgres.ts'

describe('postgres.typeName: the new kinds', () => {
  it('names the native kinds', () => {
    const names: [Parameters<typeof postgres.typeName>[0], string][] = [
      [{ kind: 'smallint' }, 'smallint'],
      [{ kind: 'real' }, 'real'],
      [{ kind: 'double' }, 'double precision'],
      [{ kind: 'time' }, 'time'],
      [{ kind: 'timestamp_no_tz' }, 'timestamp'],
      [{ kind: 'interval' }, 'interval'],
      [{ kind: 'bytea' }, 'bytea'],
      [{ kind: 'char', length: 3 }, 'char(3)'],
    ]
    for (const [type, expected] of names)
      assert.equal(postgres.typeName(type), expected)
  })

  it('keeps the logical timestamp as timestamptz and json as jsonb', () => {
    assert.equal(postgres.typeName({ kind: 'timestamp' }), 'timestamptz')
    assert.equal(postgres.typeName({ kind: 'json' }), 'jsonb')
  })

  it('writes arrays and user types', () => {
    assert.equal(
      postgres.typeName({ kind: 'array', of: { kind: 'integer' } }),
      'integer[]'
    )
    assert.equal(
      postgres.typeName({ kind: 'array', of: { kind: 'varchar', length: 9 } }),
      'varchar(9)[]'
    )
    assert.equal(
      postgres.typeName({ kind: 'user', typeId: 'e1' }, (id) => `"${id}_name"`),
      '"e1_name"'
    )
  })
})

describe('postgres.quoteLiteral', () => {
  it('wraps in single quotes and doubles the ones inside', () => {
    assert.equal(postgres.quoteLiteral("it's"), "'it''s'")
    assert.equal(postgres.quoteLiteral(''), "''")
  })
})
