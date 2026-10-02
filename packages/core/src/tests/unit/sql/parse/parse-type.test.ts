import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Cursor, ParseFailure } from '../../../../sql/parse/cursor.ts'
import { parseColumnType } from '../../../../sql/parse/parse-type.ts'
import { tokenize } from '../../../../sql/parse/tokenize.ts'

function typeOf(sql: string) {
  const warnings: string[] = []
  const cursor = new Cursor(tokenize(sql).tokens, sql, (_line, message) => {
    warnings.push(message)
  })
  const parsed = parseColumnType(cursor)
  return { ...parsed, warnings, rest: cursor.done ? '' : cursor.peek()?.text }
}

describe('parseColumnType: native types', () => {
  const cases: [string, object][] = [
    ['integer', { kind: 'integer' }],
    ['INT', { kind: 'integer' }],
    ['int4', { kind: 'integer' }],
    ['smallint', { kind: 'smallint' }],
    ['int2', { kind: 'smallint' }],
    ['bigint', { kind: 'bigint' }],
    ['int8', { kind: 'bigint' }],
    ['text', { kind: 'text' }],
    ['boolean', { kind: 'boolean' }],
    ['bool', { kind: 'boolean' }],
    ['uuid', { kind: 'uuid' }],
    ['date', { kind: 'date' }],
    ['interval', { kind: 'interval' }],
    ['json', { kind: 'json' }],
    ['jsonb', { kind: 'json' }],
    ['bytea', { kind: 'bytea' }],
    ['real', { kind: 'real' }],
    ['float4', { kind: 'real' }],
    ['double precision', { kind: 'double' }],
    ['float8', { kind: 'double' }],
    ['float', { kind: 'double' }],
    ['float(10)', { kind: 'real' }],
    ['float(40)', { kind: 'double' }],
  ]
  for (const [sql, expected] of cases) {
    it(`reads ${sql}`, () => assert.deepEqual(typeOf(sql).type, expected))
  }
})

describe('parseColumnType: time types', () => {
  it('maps timestamptz and timestamp with time zone to timestamp, the others to no-tz', () => {
    assert.deepEqual(typeOf('timestamptz').type, { kind: 'timestamp' })
    assert.deepEqual(typeOf('timestamp with time zone').type, {
      kind: 'timestamp',
    })
    assert.deepEqual(typeOf('timestamp(3) with time zone').type, {
      kind: 'timestamp',
    })
    assert.deepEqual(typeOf('timestamp').type, { kind: 'timestamp_no_tz' })
    assert.deepEqual(typeOf('timestamp without time zone').type, {
      kind: 'timestamp_no_tz',
    })
  })

  it('reads time, and warns that a time zone is not kept', () => {
    assert.deepEqual(typeOf('time').type, { kind: 'time' })
    assert.deepEqual(typeOf('time(2) without time zone').type, { kind: 'time' })
    const withZone = typeOf('time with time zone')
    assert.deepEqual(withZone.type, { kind: 'time' })
    assert.equal(withZone.warnings.length, 1)
  })
})

describe('parseColumnType: sized types', () => {
  it('reads varchar, character varying, char and character', () => {
    assert.deepEqual(typeOf('varchar(120)').type, {
      kind: 'varchar',
      length: 120,
    })
    assert.deepEqual(typeOf('character varying(5)').type, {
      kind: 'varchar',
      length: 5,
    })
    assert.deepEqual(typeOf('char(3)').type, { kind: 'char', length: 3 })
    assert.deepEqual(typeOf('character(2)').type, { kind: 'char', length: 2 })
    assert.deepEqual(typeOf('char').type, { kind: 'char', length: 1 })
    assert.deepEqual(typeOf('bpchar').type, { kind: 'char', length: 1 })
  })

  it('reads varchar without a length as text', () => {
    assert.deepEqual(typeOf('varchar').type, { kind: 'text' })
    assert.deepEqual(typeOf('character varying').type, { kind: 'text' })
  })

  it('reads numeric and decimal, with defaults and a warning when unconstrained', () => {
    assert.deepEqual(typeOf('numeric(10,2)').type, {
      kind: 'numeric',
      precision: 10,
      scale: 2,
    })
    assert.deepEqual(typeOf('decimal(8)').type, {
      kind: 'numeric',
      precision: 8,
      scale: 0,
    })
    const bare = typeOf('numeric')
    assert.deepEqual(bare.type, { kind: 'numeric', precision: 38, scale: 10 })
    assert.equal(bare.warnings.length, 1)
  })

  it('stops after the type, leaving the rest', () => {
    assert.equal(typeOf('integer NOT NULL').rest, 'NOT')
  })
})

describe('parseColumnType: sizes that make no sense', () => {
  it('fails for a size that is not a whole number or is below 1', () => {
    for (const sql of [
      'varchar(1.5)',
      'char(0)',
      'numeric(0)',
      'varchar(-3)',
    ]) {
      assert.throws(() => typeOf(sql), ParseFailure, sql)
    }
  })

  it('clamps a length or precision over the limit and a scale over the precision, with a warning', () => {
    const long = typeOf('varchar(99999999999)')
    assert.deepEqual(long.type, { kind: 'varchar', length: 10_485_760 })
    assert.equal(long.warnings.length, 1)
    const wide = typeOf('numeric(5000)')
    assert.deepEqual(wide.type, { kind: 'numeric', precision: 1000, scale: 0 })
    assert.equal(wide.warnings.length, 1)
    const scale = typeOf('numeric(10, 20)')
    assert.deepEqual(scale.type, { kind: 'numeric', precision: 10, scale: 10 })
    assert.equal(scale.warnings.length, 1)
  })
})

describe('parseColumnType: serial', () => {
  it('reads serial types as integers marked serial', () => {
    assert.deepEqual(typeOf('serial'), {
      type: { kind: 'integer' },
      serial: true,
      warnings: [],
      rest: '',
    })
    assert.deepEqual(typeOf('bigserial').type, { kind: 'bigint' })
    assert.equal(typeOf('bigserial').serial, true)
    assert.deepEqual(typeOf('smallserial').type, { kind: 'smallint' })
    assert.equal(typeOf('integer').serial, false)
  })
})

describe('parseColumnType: arrays and named types', () => {
  it('reads [] and ARRAY suffixes as one array level, however many dimensions', () => {
    const ints = { kind: 'array', of: { kind: 'integer' } }
    assert.deepEqual(typeOf('integer[]').type, ints)
    assert.deepEqual(typeOf('integer[3]').type, ints)
    assert.deepEqual(typeOf('integer[][]').type, ints)
    assert.deepEqual(typeOf('integer ARRAY').type, ints)
    assert.deepEqual(typeOf('varchar(5)[]').type, {
      kind: 'array',
      of: { kind: 'varchar', length: 5 },
    })
  })

  it('reads any other name as a named type, quoted or schema-qualified', () => {
    assert.deepEqual(typeOf('mood').type, { kind: 'named', name: 'mood' })
    assert.deepEqual(typeOf('"Mood"').type, { kind: 'named', name: 'Mood' })
    assert.deepEqual(typeOf('public.mood').type, {
      kind: 'named',
      name: 'mood',
    })
    assert.deepEqual(typeOf('mood[]').type, {
      kind: 'array',
      of: { kind: 'named', name: 'mood' },
    })
    assert.deepEqual(typeOf('money').type, { kind: 'named', name: 'money' })
  })

  it('warns about a schema other than public and fails with no type at all', () => {
    assert.equal(typeOf('app.mood').warnings.length, 1)
    assert.throws(() => typeOf(''), ParseFailure)
    assert.throws(() => typeOf('(1)'), ParseFailure)
  })
})
