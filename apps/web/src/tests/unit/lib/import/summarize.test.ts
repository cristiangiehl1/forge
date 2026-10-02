import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema } from '@forge/core'

import {
  describeSummary,
  isEmptyImport,
  limitMessages,
  summarize,
} from '../../../../lib/import/summarize.ts'

const schema: Schema = {
  version: 1,
  tables: [
    {
      id: 't1',
      name: 'a',
      columns: [
        { id: 'c1', name: 'x', type: { kind: 'text' }, nullable: true },
        { id: 'c2', name: 'y', type: { kind: 'text' }, nullable: true },
      ],
      primaryKey: [],
      indexes: [
        { id: 'i', name: 'i', columns: ['c1'], unique: false, method: 'btree' },
      ],
    },
    { id: 't2', name: 'b', columns: [], primaryKey: [] },
  ],
  relationships: [
    {
      id: 'r',
      from: { tableId: 't1', columnId: 'c1' },
      to: { tableId: 't2', columnId: 'c' },
    },
  ],
  types: [{ kind: 'enum', id: 'e', name: 'k', values: ['a'] }],
}

describe('summarize', () => {
  it('counts tables, columns, relationships, indexes and types', () => {
    assert.deepEqual(summarize(schema), {
      tables: 2,
      columns: 2,
      relationships: 1,
      indexes: 1,
      types: 1,
    })
    assert.deepEqual(summarize({ version: 1, tables: [], relationships: [] }), {
      tables: 0,
      columns: 0,
      relationships: 0,
      indexes: 0,
      types: 0,
    })
  })
})

describe('describeSummary', () => {
  it('pluralises, and leaves out what is zero', () => {
    assert.equal(
      describeSummary({
        tables: 7,
        columns: 28,
        relationships: 8,
        indexes: 3,
        types: 1,
      }),
      '7 tables, 28 columns, 8 relationships, 3 indexes, 1 type'
    )
    assert.equal(
      describeSummary({
        tables: 1,
        columns: 1,
        relationships: 0,
        indexes: 0,
        types: 0,
      }),
      '1 table, 1 column'
    )
    assert.equal(
      describeSummary({
        tables: 0,
        columns: 0,
        relationships: 0,
        indexes: 0,
        types: 0,
      }),
      'nothing'
    )
  })
})

describe('isEmptyImport', () => {
  it('is true only with no tables and no types', () => {
    assert.equal(
      isEmptyImport({
        tables: 0,
        columns: 0,
        relationships: 0,
        indexes: 0,
        types: 0,
      }),
      true
    )
    assert.equal(
      isEmptyImport({
        tables: 0,
        columns: 0,
        relationships: 0,
        indexes: 0,
        types: 1,
      }),
      false
    )
    assert.equal(
      isEmptyImport({
        tables: 1,
        columns: 0,
        relationships: 0,
        indexes: 0,
        types: 0,
      }),
      false
    )
  })
})

describe('limitMessages', () => {
  it('shows the first ones and counts the rest', () => {
    assert.deepEqual(limitMessages([1, 2, 3, 4, 5], 3), {
      shown: [1, 2, 3],
      hidden: 2,
    })
    assert.deepEqual(limitMessages([1, 2], 3), { shown: [1, 2], hidden: 0 })
    assert.deepEqual(limitMessages([], 3), { shown: [], hidden: 0 })
  })
})
