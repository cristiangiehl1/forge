import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { tokenize } from '../../../../sql/parse/tokenize.ts'

describe('tokenize in Oracle', () => {
  it('skips a line that is only a slash, and nothing else', () => {
    const sql =
      'CREATE TABLE a (x NUMBER);\n/\nCREATE TABLE b (y NUMBER);\n  /  \n'
    assert.equal(
      tokenize(sql, 'oracle').tokens.filter((t) => t.value === 'create').length,
      2
    )
    assert.equal(
      tokenize(sql, 'oracle').tokens.some((t) => t.value === '/'),
      false
    )
    // the slash is an operator in PostgreSQL, and a division inside an expression is untouched
    assert.equal(
      tokenize(sql, 'postgres').tokens.some((t) => t.value === '/'),
      true
    )
    assert.equal(
      tokenize('SELECT a / b', 'oracle').tokens.some((t) => t.value === '/'),
      true
    )
  })
})
