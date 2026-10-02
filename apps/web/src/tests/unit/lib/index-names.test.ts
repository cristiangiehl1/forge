import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { defaultIndexName, renamedByDefault } from '../../../lib/index-names.ts'

describe('defaultIndexName', () => {
  it('is idx_<table>_<columns>, or uq_ for a unique index', () => {
    assert.equal(defaultIndexName('users', ['email'], false), 'idx_users_email')
    assert.equal(defaultIndexName('users', ['a', 'b'], true), 'uq_users_a_b')
  })
})

describe('renamedByDefault', () => {
  it('follows the index when its name is still the default one', () => {
    assert.equal(
      renamedByDefault(
        {
          table: 'users',
          name: 'idx_users_email',
          columns: ['email'],
          unique: false,
        },
        { unique: true }
      ),
      'uq_users_email'
    )
    assert.equal(
      renamedByDefault(
        {
          table: 'users',
          name: 'uq_users_email',
          columns: ['email'],
          unique: true,
        },
        { columns: ['email', 'name'] }
      ),
      'uq_users_email_name'
    )
  })

  it('leaves a name the user chose, and returns null when nothing changes', () => {
    assert.equal(
      renamedByDefault(
        { table: 'users', name: 'my_index', columns: ['email'], unique: false },
        { unique: true }
      ),
      null
    )
    assert.equal(
      renamedByDefault(
        {
          table: 'users',
          name: 'idx_users_email',
          columns: ['email'],
          unique: false,
        },
        { unique: false }
      ),
      null
    )
  })
})
