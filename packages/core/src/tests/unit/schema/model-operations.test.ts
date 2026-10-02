import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  addColumn,
  addIndex,
  addTable,
  addType,
  createSchema,
  removeColumn,
  removeIndex,
  removeTable,
  removeType,
  setTableComment,
  typeDependsOn,
  typeUsages,
  updateIndex,
  updateType,
} from '../../../schema/operations.ts'
import type { Index, Schema, UserType } from '../../../schema/types.ts'

const idx = (over: Partial<Index> = {}): Index => ({
  id: 'i1',
  name: 'idx_a',
  columns: ['c1'],
  unique: false,
  method: 'btree',
  ...over,
})

function base(): Schema {
  let s = addTable(createSchema(), { id: 't', name: 'users' })
  s = addColumn(s, 't', {
    id: 'c1',
    name: 'a',
    type: { kind: 'text' },
    nullable: true,
  })
  s = addColumn(s, 't', {
    id: 'c2',
    name: 'b',
    type: { kind: 'text' },
    nullable: true,
  })
  return s
}

describe('setTableComment', () => {
  it('sets a comment, and removes the key when it is blank', () => {
    const commented = setTableComment(base(), 't', 'People')
    assert.equal(commented.tables[0]?.comment, 'People')
    const cleared = setTableComment(commented, 't', '  ')
    assert.equal('comment' in (cleared.tables[0] ?? {}), false)
  })

  it('ignores an unknown table', () => {
    const s = base()
    assert.equal(setTableComment(s, 'nope', 'x'), s)
  })
})

describe('indexes', () => {
  it('adds, updates and removes an index, without touching the original', () => {
    const s = base()
    const added = addIndex(s, 't', idx())
    assert.equal(s.tables[0]?.indexes, undefined)
    assert.deepEqual(added.tables[0]?.indexes, [idx()])

    const updated = updateIndex(added, 't', 'i1', {
      unique: true,
      id: 'ignored',
    } as never)
    assert.equal(updated.tables[0]?.indexes?.[0]?.unique, true)
    assert.equal(updated.tables[0]?.indexes?.[0]?.id, 'i1')

    const removed = removeIndex(updated, 't', 'i1')
    assert.deepEqual(removed.tables[0]?.indexes, [])
  })

  it('ignores an unknown table or index', () => {
    const s = addIndex(base(), 't', idx())
    assert.equal(addIndex(s, 'nope', idx()), s)
    assert.equal(updateIndex(s, 't', 'nope', { unique: true }), s)
    assert.equal(removeIndex(s, 't', 'nope'), s)
  })

  it('removing a column drops it from an index, and drops an index left empty', () => {
    let s = addIndex(base(), 't', idx({ id: 'i1', columns: ['c1', 'c2'] }))
    s = addIndex(s, 't', idx({ id: 'i2', name: 'idx_b', columns: ['c1'] }))
    const after = removeColumn(s, 't', 'c1')
    assert.deepEqual(after.tables[0]?.indexes, [
      idx({ id: 'i1', columns: ['c2'] }),
    ])
  })

  it('removing a column leaves a table without indexes without an indexes key', () => {
    const after = removeColumn(base(), 't', 'c1')
    assert.equal('indexes' in (after.tables[0] ?? {}), false)
  })

  it('removing a table takes its indexes with it', () => {
    const s = removeTable(addIndex(base(), 't', idx()), 't')
    assert.deepEqual(s.tables, [])
  })
})

describe('user types', () => {
  const colour: UserType = {
    kind: 'enum',
    id: 'e1',
    name: 'colour',
    values: ['red'],
  }

  it('adds, updates and removes a type', () => {
    const added = addType(base(), colour)
    assert.deepEqual(added.types, [colour])
    const updated = updateType(added, { ...colour, values: ['red', 'green'] })
    assert.deepEqual(updated.types?.[0], {
      ...colour,
      values: ['red', 'green'],
    })
    assert.deepEqual(removeType(updated, 'e1').types, [])
  })

  it('finds where a type is used: a column, an array, a domain', () => {
    let s = addType(base(), colour)
    s = addType(s, {
      kind: 'domain',
      id: 'd1',
      name: 'shade',
      base: { kind: 'user', typeId: 'e1' },
    })
    s = addColumn(s, 't', {
      id: 'c3',
      name: 'x',
      type: { kind: 'user', typeId: 'e1' },
      nullable: true,
    })
    s = addColumn(s, 't', {
      id: 'c4',
      name: 'y',
      type: { kind: 'array', of: { kind: 'user', typeId: 'e1' } },
      nullable: true,
    })
    assert.deepEqual(typeUsages(s, 'e1'), [
      { kind: 'column', tableId: 't', columnId: 'c3' },
      { kind: 'column', tableId: 't', columnId: 'c4' },
      { kind: 'domain', typeId: 'd1' },
    ])
  })

  it('refuses to remove a type that is in use, and returns the same schema', () => {
    const s = addColumn(addType(base(), colour), 't', {
      id: 'c3',
      name: 'x',
      type: { kind: 'user', typeId: 'e1' },
      nullable: true,
    })
    assert.equal(removeType(s, 'e1'), s)
  })

  it('refuses to remove a type that a domain is based on', () => {
    let s = addType(base(), colour)
    s = addType(s, {
      kind: 'domain',
      id: 'd1',
      name: 'shade',
      base: { kind: 'user', typeId: 'e1' },
    })
    assert.equal(removeType(s, 'e1'), s)
    assert.deepEqual(
      removeType(s, 'd1').types?.map((type) => type.id),
      ['e1']
    )
  })

  it('ignores an unknown type', () => {
    const s = addType(base(), colour)
    assert.equal(updateType(s, { ...colour, id: 'nope' }), s)
    assert.equal(removeType(s, 'nope'), s)
  })
})

describe('typeDependsOn and a self-based domain', () => {
  const domain = (id: string, base: string): UserType => ({
    kind: 'domain',
    id,
    name: id,
    base: { kind: 'user', typeId: base },
  })

  it('follows domains transitively', () => {
    let s = addType(base(), { kind: 'enum', id: 'e', name: 'e', values: ['x'] })
    s = addType(s, domain('d1', 'e'))
    s = addType(s, domain('d2', 'd1'))
    assert.equal(typeDependsOn(s, 'd2', 'e'), true)
    assert.equal(typeDependsOn(s, 'd1', 'e'), true)
    assert.equal(typeDependsOn(s, 'e', 'd2'), false)
    assert.equal(typeDependsOn(s, 'e', 'e'), false)
  })

  it('terminates on a cycle', () => {
    const s = addType(addType(base(), domain('a', 'b')), domain('b', 'a'))
    assert.equal(typeDependsOn(s, 'a', 'b'), true)
    assert.equal(typeDependsOn(s, 'a', 'zzz'), false)
  })

  it('does not count a domain based on itself as using itself, so it can be removed', () => {
    const s = addType(base(), domain('a', 'a'))
    assert.deepEqual(typeUsages(s, 'a'), [])
    assert.deepEqual(removeType(s, 'a').types, [])
  })
})
