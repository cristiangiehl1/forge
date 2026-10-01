import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  addColumn,
  addRelationship,
  addTable,
  createSchema,
  removeColumn,
  removeRelationship,
  removeTable,
  renameTable,
  setPrimaryKey,
  updateColumn,
} from '../../../schema/operations.ts'
import {
  ordersTable,
  ordersToUsers,
  usersOrders,
  usersTable,
} from '../../helpers/fixtures.ts'
import { column, schemaOf, table } from '../../helpers/schema-builders.ts'

describe('createSchema', () => {
  it('returns an empty version 1 schema', () => {
    assert.deepEqual(createSchema(), {
      version: 1,
      tables: [],
      relationships: [],
    })
  })
})

describe('addTable', () => {
  it('appends a table with no columns and no primary key', () => {
    const result = addTable(createSchema(), { id: 't1', name: 'users' })
    assert.deepEqual(result, schemaOf([table('t1', 'users')]))
  })

  it('does not mutate the input schema', () => {
    const before = createSchema()
    const after = addTable(before, { id: 't1', name: 'users' })
    assert.notEqual(before, after)
    assert.deepEqual(before.tables, [])
  })
})

describe('renameTable', () => {
  it('renames only the target table and keeps the others by reference', () => {
    const result = renameTable(usersOrders, 'users', 'people')
    assert.equal(result.tables[0]?.name, 'people')
    assert.equal(result.tables[1], ordersTable)
  })

  it('returns the same schema for an unknown table', () => {
    assert.equal(renameTable(usersOrders, 'nope', 'x'), usersOrders)
  })
})

describe('removeTable', () => {
  it('removes the table and every relationship that touches it', () => {
    const fromSide = removeTable(usersOrders, 'orders')
    assert.deepEqual(fromSide.tables, [usersTable])
    assert.deepEqual(fromSide.relationships, [])

    const toSide = removeTable(usersOrders, 'users')
    assert.deepEqual(toSide.tables, [ordersTable])
    assert.deepEqual(toSide.relationships, [])
  })

  it('returns the same schema for an unknown table', () => {
    assert.equal(removeTable(usersOrders, 'nope'), usersOrders)
  })
})

describe('addColumn', () => {
  it('appends the column to the table', () => {
    const schema = schemaOf([table('t1', 'users')])
    const result = addColumn(schema, 't1', column('c1', 'id'))
    assert.deepEqual(result.tables[0]?.columns, [column('c1', 'id')])
  })

  it('returns the same schema for an unknown table', () => {
    assert.equal(addColumn(usersOrders, 'nope', column('c1', 'x')), usersOrders)
  })
})

describe('updateColumn', () => {
  it('patches name, type and nullable, and keeps the id', () => {
    const result = updateColumn(usersOrders, 'users', 'u_name', {
      name: 'full_name',
      type: { kind: 'text' },
      nullable: true,
    })
    assert.deepEqual(result.tables[0]?.columns[1], {
      id: 'u_name',
      name: 'full_name',
      type: { kind: 'text' },
      nullable: true,
    })
  })

  it('returns the same schema for an unknown table or column', () => {
    assert.equal(updateColumn(usersOrders, 'nope', 'u_id', {}), usersOrders)
    assert.equal(updateColumn(usersOrders, 'users', 'nope', {}), usersOrders)
  })
})

describe('removeColumn', () => {
  it('removes the column, its primary-key entry and its relationships', () => {
    const fromSide = removeColumn(usersOrders, 'orders', 'o_user')
    assert.equal(fromSide.tables[1]?.columns.length, 3)
    assert.deepEqual(fromSide.relationships, [])

    const toSide = removeColumn(usersOrders, 'users', 'u_id')
    assert.deepEqual(toSide.tables[0]?.primaryKey, [])
    assert.deepEqual(toSide.relationships, [])
  })

  it('returns the same schema for an unknown table or column', () => {
    assert.equal(removeColumn(usersOrders, 'nope', 'u_id'), usersOrders)
    assert.equal(removeColumn(usersOrders, 'users', 'nope'), usersOrders)
  })
})

describe('setPrimaryKey', () => {
  it('sets a composite key in the given order', () => {
    const schema = schemaOf([
      table('t', 't', [column('a', 'a'), column('b', 'b')]),
    ])
    const result = setPrimaryKey(schema, 't', ['b', 'a'])
    assert.deepEqual(result.tables[0]?.primaryKey, ['b', 'a'])
  })

  it('drops duplicates and ids that are not columns of the table', () => {
    const result = setPrimaryKey(usersOrders, 'users', ['u_id', 'u_id', 'x'])
    assert.deepEqual(result.tables[0]?.primaryKey, ['u_id'])
  })

  it('clears the key with an empty list', () => {
    const result = setPrimaryKey(usersOrders, 'users', [])
    assert.deepEqual(result.tables[0]?.primaryKey, [])
  })

  it('returns the same schema for an unknown table', () => {
    assert.equal(setPrimaryKey(usersOrders, 'nope', []), usersOrders)
  })
})

describe('addRelationship and removeRelationship', () => {
  it('adds a relationship and removes it by id', () => {
    const schema = schemaOf([usersTable, ordersTable])
    const added = addRelationship(schema, ordersToUsers)
    assert.deepEqual(added.relationships, [ordersToUsers])

    const removed = removeRelationship(added, 'fk1')
    assert.deepEqual(removed.relationships, [])
  })

  it('returns the same schema when the relationship does not exist', () => {
    assert.equal(removeRelationship(usersOrders, 'nope'), usersOrders)
  })
})
