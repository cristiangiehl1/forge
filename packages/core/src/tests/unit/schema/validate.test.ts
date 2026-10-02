import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { addRelationship } from '../../../schema/operations.ts'
import type { ColumnType } from '../../../schema/types.ts'
import { checkRelationship, validate } from '../../../schema/validate.ts'
import { ordersToUsers, usersOrders } from '../../helpers/fixtures.ts'
import { column, schemaOf, table } from '../../helpers/schema-builders.ts'

const codes = (schema: Parameters<typeof validate>[0]) =>
  validate(schema).map((issue) => issue.code)

describe('validate', () => {
  it('accepts a well-formed schema', () => {
    assert.deepEqual(validate(usersOrders), [])
  })

  it('accepts an empty schema', () => {
    assert.deepEqual(validate(schemaOf([])), [])
  })

  it('flags empty and blank table names', () => {
    const schema = schemaOf([table('a', ''), table('b', '   ')])
    assert.deepEqual(codes(schema), ['empty-table-name', 'empty-table-name'])
  })

  it('flags a duplicate table name on the later table, case-sensitively', () => {
    const schema = schemaOf([
      table('a', 'users'),
      table('b', 'users'),
      table('c', 'Users'),
    ])
    const issues = validate(schema)
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.code, 'duplicate-table-name')
    assert.equal(issues[0]?.tableId, 'b')
  })

  it('flags empty and duplicate column names inside one table', () => {
    const schema = schemaOf([
      table('t', 't', [column('c1', 'x'), column('c2', 'x'), column('c3', '')]),
      table('u', 'u', [column('c4', 'x')]),
    ])
    const issues = validate(schema)
    assert.deepEqual(
      issues.map((issue) => [issue.code, issue.columnId]),
      [
        ['duplicate-column-name', 'c2'],
        ['empty-column-name', 'c3'],
      ]
    )
  })

  it('flags both relationships when one column is the source of two', () => {
    const second = { ...ordersToUsers, id: 'fk2' }
    const schema = addRelationship(usersOrders, second)
    const issues = validate(schema).filter(
      (issue) => issue.code === 'multiple-relationships-from-column'
    )
    assert.deepEqual(issues.map((issue) => issue.relationshipId).sort(), [
      'fk1',
      'fk2',
    ])
  })

  it('flags a relationship between columns of different types', () => {
    const schema = schemaOf(
      [
        table('a', 'a', [column('a_id', 'id', { kind: 'uuid' })], ['a_id']),
        table('b', 'b', [column('b_ref', 'ref', { kind: 'text' })]),
      ],
      [
        {
          id: 'r',
          from: { tableId: 'b', columnId: 'b_ref' },
          to: { tableId: 'a', columnId: 'a_id' },
        },
      ]
    )
    assert.deepEqual(codes(schema), ['relationship-type-mismatch'])
  })

  it('ignores varchar length when comparing types', () => {
    const schema = schemaOf(
      [
        table(
          'a',
          'a',
          [column('a_id', 'id', { kind: 'varchar', length: 10 })],
          ['a_id']
        ),
        table('b', 'b', [
          column('b_ref', 'ref', { kind: 'varchar', length: 40 }),
        ]),
      ],
      [
        {
          id: 'r',
          from: { tableId: 'b', columnId: 'b_ref' },
          to: { tableId: 'a', columnId: 'a_id' },
        },
      ]
    )
    assert.deepEqual(validate(schema), [])
  })

  it('flags a target that is not a primary key', () => {
    const schema = schemaOf(
      [
        table(
          'a',
          'a',
          [column('a_id', 'id'), column('a_other', 'other')],
          ['a_id']
        ),
        table('b', 'b', [column('b_ref', 'ref')]),
      ],
      [
        {
          id: 'r',
          from: { tableId: 'b', columnId: 'b_ref' },
          to: { tableId: 'a', columnId: 'a_other' },
        },
      ]
    )
    assert.deepEqual(codes(schema), [
      'relationship-target-not-sole-primary-key',
    ])
  })

  it('flags a target that is part of a composite primary key', () => {
    const schema = schemaOf(
      [
        table('a', 'a', [column('k1', 'k1'), column('k2', 'k2')], ['k1', 'k2']),
        table('b', 'b', [column('b_ref', 'ref')]),
      ],
      [
        {
          id: 'r',
          from: { tableId: 'b', columnId: 'b_ref' },
          to: { tableId: 'a', columnId: 'k1' },
        },
      ]
    )
    assert.deepEqual(codes(schema), [
      'relationship-target-not-sole-primary-key',
    ])
  })

  it('flags a relationship whose table or column does not exist', () => {
    const schema = addRelationship(usersOrders, {
      id: 'ghost',
      from: { tableId: 'orders', columnId: 'gone' },
      to: { tableId: 'users', columnId: 'u_id' },
    })
    assert.ok(codes(schema).includes('relationship-unknown-column'))
  })

  it('accepts a self-referencing relationship', () => {
    const schema = schemaOf(
      [
        table(
          'e',
          'employees',
          [
            column('e_id', 'id', { kind: 'uuid' }, false),
            column('e_mgr', 'manager_id', { kind: 'uuid' }),
          ],
          ['e_id']
        ),
      ],
      [
        {
          id: 'r',
          from: { tableId: 'e', columnId: 'e_mgr' },
          to: { tableId: 'e', columnId: 'e_id' },
        },
      ]
    )
    assert.deepEqual(validate(schema), [])
  })
})

describe('checkRelationship', () => {
  const ordersTotal = { tableId: 'orders', columnId: 'o_total' }
  const usersId = { tableId: 'users', columnId: 'u_id' }

  it('returns null for an allowed relationship', () => {
    const noRelationships = schemaOf(usersOrders.tables)
    assert.equal(
      checkRelationship(
        noRelationships,
        { tableId: 'orders', columnId: 'o_user' },
        usersId
      ),
      null
    )
  })

  it('reports the rule that the relationship would break', () => {
    const noRelationships = schemaOf(usersOrders.tables)
    assert.equal(
      checkRelationship(noRelationships, ordersTotal, usersId)?.code,
      'relationship-type-mismatch'
    )
    assert.equal(
      checkRelationship(
        noRelationships,
        { tableId: 'users', columnId: 'u_name' },
        { tableId: 'orders', columnId: 'o_user' }
      )?.code,
      'relationship-type-mismatch'
    )
    assert.equal(
      checkRelationship(
        noRelationships,
        { tableId: 'orders', columnId: 'o_user' },
        { tableId: 'orders', columnId: 'o_user' }
      )?.code,
      'relationship-target-not-sole-primary-key'
    )
  })

  it('refuses a second relationship from the same column', () => {
    assert.equal(
      checkRelationship(usersOrders, ordersToUsers.from, usersId)?.code,
      'multiple-relationships-from-column'
    )
  })

  it('reports unknown columns', () => {
    assert.equal(
      checkRelationship(
        usersOrders,
        { tableId: 'nope', columnId: 'x' },
        usersId
      )?.code,
      'relationship-unknown-column'
    )
  })
})

describe('validate: generated columns', () => {
  const withColumn = (type: ColumnType, generated?: boolean) =>
    schemaOf([
      table('t', 't', [
        {
          ...column('c', 'c', type),
          ...(generated === undefined ? {} : { generated }),
        },
      ]),
    ])

  it('accepts a generated integer, bigint or uuid column', () => {
    for (const kind of ['integer', 'bigint', 'uuid'] as const) {
      assert.deepEqual(validate(withColumn({ kind }, true)), [])
    }
  })

  it('accepts a column that is not generated, whatever its type', () => {
    assert.deepEqual(validate(withColumn({ kind: 'text' })), [])
    assert.deepEqual(validate(withColumn({ kind: 'text' }, false)), [])
  })

  it('flags a generated column of a type the database cannot generate', () => {
    for (const type of [
      { kind: 'text' },
      { kind: 'boolean' },
      { kind: 'varchar', length: 10 },
      { kind: 'numeric', precision: 5, scale: 2 },
    ] as ColumnType[]) {
      const issues = validate(withColumn(type, true))
      assert.equal(issues.length, 1)
      assert.equal(issues[0]?.code, 'generated-unsupported-type')
      assert.equal(issues[0]?.tableId, 't')
      assert.equal(issues[0]?.columnId, 'c')
    }
  })
})

describe('validate: a relationship that points at nothing', () => {
  it('names the relationship, so a list of problems can tell them apart', () => {
    const schema = addRelationship(usersOrders, {
      id: 'ghost',
      from: { tableId: 'orders', columnId: 'gone' },
      to: { tableId: 'users', columnId: 'u_id' },
    })
    const unknown = validate(schema).find(
      (issue) => issue.code === 'relationship-unknown-column'
    )
    assert.equal(unknown?.relationshipId, 'ghost')
  })
})
