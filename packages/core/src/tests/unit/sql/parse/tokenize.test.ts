import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { splitStatements, tokenize } from '../../../../sql/parse/tokenize.ts'

const values = (sql: string) => tokenize(sql).tokens.map((token) => token.value)
const kinds = (sql: string) => tokenize(sql).tokens.map((token) => token.kind)

describe('tokenize: words, identifiers, numbers and symbols', () => {
  it('lower-cases words, keeps the case of quoted identifiers, and unescapes ""', () => {
    assert.deepEqual(values('Create TABLE "Users" ("a""b")'), [
      'create',
      'table',
      'Users',
      '(',
      'a"b',
      ')',
    ])
    assert.deepEqual(kinds('Create "x" 12'), ['word', 'ident', 'number'])
  })

  it('reads numbers with decimals and exponents', () => {
    assert.deepEqual(values('1 2.5 .5 1e10 3E-2'), [
      '1',
      '2.5',
      '.5',
      '1e10',
      '3E-2',
    ])
  })

  it('reads :: as one symbol and every other symbol alone', () => {
    assert.deepEqual(values('a::int[],(x)'), [
      'a',
      '::',
      'int',
      '[',
      ']',
      ',',
      '(',
      'x',
      ')',
    ])
  })

  it('keeps offsets and lines', () => {
    const { tokens } = tokenize('a\n  bb')
    assert.deepEqual(
      tokens.map((t) => [t.text, t.line, t.start, t.end]),
      [
        ['a', 1, 0, 1],
        ['bb', 2, 4, 6],
      ]
    )
  })
})

describe('tokenize: strings', () => {
  it('collapses doubled quotes and keeps semicolons and keywords inside', () => {
    const { tokens } = tokenize("'it''s; CREATE TABLE'")
    assert.equal(tokens.length, 1)
    assert.equal(tokens[0]?.kind, 'string')
    assert.equal(tokens[0]?.value, "it's; CREATE TABLE")
  })

  it('decodes E-strings and reads dollar-quoted bodies whole', () => {
    assert.deepEqual(values("E'a\\'b\\n'"), ["a'b\n"])
    assert.deepEqual(values('$$ x; y $$'), [' x; y '])
    assert.deepEqual(values('$tag$ a $$ b $tag$'), [' a $$ b '])
  })

  it('spans lines inside a string and counts them', () => {
    const { tokens } = tokenize("'a\nb' x")
    assert.equal(tokens[1]?.line, 2)
  })
})

describe('tokenize: comments, meta-commands and COPY data', () => {
  it('skips line comments and nested block comments, counting lines', () => {
    const { tokens, errors } = tokenize(
      'a -- x; y\n/* one /* two */ still */ b'
    )
    assert.deepEqual(errors, [])
    assert.deepEqual(
      tokens.map((t) => [t.value, t.line]),
      [
        ['a', 1],
        ['b', 2],
      ]
    )
  })

  it('skips psql meta-command lines', () => {
    assert.deepEqual(values('\\connect db\nselect 1'), ['select', '1'])
  })

  it('skips the data of COPY … FROM stdin up to \\. and keeps what follows', () => {
    const sql = 'COPY t (a) FROM stdin;\n1\tx;y\n2\tz\n\\.\n\nselect 2;'
    const result = tokenize(sql)
    assert.deepEqual(
      result.tokens.map((t) => t.value),
      ['copy', 't', '(', 'a', ')', 'from', 'stdin', ';', 'select', '2', ';']
    )
    assert.equal(result.tokens.find((t) => t.value === 'select')?.line, 6)
  })

  it('does not skip anything for a COPY that is not from stdin', () => {
    assert.deepEqual(values("COPY t TO '/tmp/x';\nselect 1"), [
      'copy',
      't',
      'to',
      '/tmp/x',
      ';',
      'select',
      '1',
    ])
  })
})

describe('tokenize: truncated input', () => {
  it('reports an unterminated string, identifier, dollar quote and comment with their line', () => {
    for (const sql of [
      "select 'abc",
      'select "abc',
      'select $$abc',
      'select /* abc',
    ]) {
      const { errors } = tokenize(`\n${sql}`)
      assert.equal(errors.length, 1, sql)
      assert.equal(errors[0]?.line, 2, sql)
    }
  })

  it('keeps the tokens read before the problem', () => {
    assert.deepEqual(values("select 1; select 'x"), [
      'select',
      '1',
      ';',
      'select',
    ])
  })
})

describe('splitStatements', () => {
  const split = (sql: string) => splitStatements(sql, tokenize(sql).tokens)

  it('splits at semicolons, drops empty statements and keeps the last one without a semicolon', () => {
    const statements = split(';; select 1;\n\nselect 2')
    assert.deepEqual(
      statements.map((s) => [s.line, s.text, s.tokens.length]),
      [
        [1, 'select 1', 2],
        [3, 'select 2', 2],
      ]
    )
  })

  it('does not split inside strings, comments or dollar-quoted bodies', () => {
    assert.equal(split("select 'a;b'; -- ;\nselect $$ ; $$").length, 2)
  })
})
