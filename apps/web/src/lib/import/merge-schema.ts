import type { Schema, Table, TableId, UserType } from '@forge/core'

export interface Renamed {
  kind: 'table' | 'index' | 'type'
  from: string
  to: string
}

/** `name`, or `name_2`, `name_3`… until it is free; the result is added to `taken`. */
export function freeName(name: string, taken: Set<string>): string {
  let result = name
  for (let attempt = 2; taken.has(result); attempt++) {
    result = `${name}_${attempt}`
  }
  taken.add(result)
  return result
}

/**
 * Appends an imported schema to the current one. A table, an index or a type
 * whose name is already taken is renamed, so nothing the user has is touched.
 * Relationships point at ids, which are unique already, so they survive a rename.
 */
export function mergeImported(
  current: Schema,
  imported: Schema
): { schema: Schema; addedTableIds: TableId[]; renamed: Renamed[] } {
  const tableNames = new Set(current.tables.map((table) => table.name))
  const indexNames = new Set(
    current.tables.flatMap((table) =>
      (table.indexes ?? []).map((index) => index.name)
    )
  )
  const typeNames = new Set((current.types ?? []).map((type) => type.name))
  const renamed: Renamed[] = []
  const rename = (kind: Renamed['kind'], name: string, taken: Set<string>) => {
    const result = freeName(name, taken)
    if (result !== name) renamed.push({ kind, from: name, to: result })
    return result
  }

  const tables = imported.tables.map((table): Table => {
    const name = rename('table', table.name, tableNames)
    const indexes = table.indexes?.map((index) => ({
      ...index,
      name: rename('index', index.name, indexNames),
    }))
    return { ...table, name, ...(indexes ? { indexes } : {}) }
  })
  const types = (imported.types ?? []).map(
    (type): UserType => ({
      ...type,
      name: rename('type', type.name, typeNames),
    })
  )

  const allTypes = [...(current.types ?? []), ...types]
  const schema: Schema = {
    ...current,
    tables: [...current.tables, ...tables],
    relationships: [...current.relationships, ...imported.relationships],
    ...(allTypes.length > 0 ? { types: allTypes } : {}),
  }
  return { schema, addedTableIds: tables.map((table) => table.id), renamed }
}
