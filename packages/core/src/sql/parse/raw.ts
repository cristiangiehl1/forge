import type { ColumnType } from '../../schema/types.ts'

/** Where a piece of the script came from, for messages. */
export interface Origin {
  line: number
  text: string
}

/** A column type as written: user types are still names, to be resolved later. */
export type RawType =
  | Exclude<ColumnType, { kind: 'array' } | { kind: 'user' }>
  | { kind: 'named'; name: string }
  | { kind: 'array'; of: RawType }

export interface RawReference {
  table: string
  /** Empty means the referenced table's primary key. */
  columns: string[]
  /** ON DELETE / ON UPDATE actions were written (and are not modelled). */
  actions: boolean
}

export interface RawColumn {
  name: string
  type: RawType
  notNull: boolean
  primaryKey: boolean
  unique: boolean
  /** An identity or a serial. */
  generated: boolean
  default?: string
  reference?: RawReference
}

export interface RawForeignKey {
  columns: string[]
  reference: RawReference
}

export interface RawUnique {
  name?: string
  columns: string[]
}

export interface RawTable {
  origin: Origin
  name: string
  columns: RawColumn[]
  primaryKey: string[]
  uniques: RawUnique[]
  foreignKeys: RawForeignKey[]
}

export interface RawIndex {
  origin: Origin
  name?: string
  table: string
  columns: string[]
  unique: boolean
  method: string
}

export interface RawEnum {
  origin: Origin
  kind: 'enum'
  name: string
  values: string[]
}

export interface RawDomain {
  origin: Origin
  kind: 'domain'
  name: string
  base: RawType
  notNull: boolean
  default?: string
}

export interface RawComment {
  origin: Origin
  table: string
  /** Absent for a table comment. */
  column?: string
  text: string
}

export type RawAlter = { origin: Origin; table: string } & (
  | { primaryKey: string[] }
  | { unique: RawUnique }
  | { foreignKey: RawForeignKey }
  /** `ALTER COLUMN c SET DEFAULT expr`, as pg_dump writes a serial's default. */
  | { setDefault: { column: string; expression: string } }
  /** `ALTER COLUMN c ADD GENERATED … AS IDENTITY`. */
  | { identity: string }
)

export interface RawScript {
  tables: RawTable[]
  indexes: RawIndex[]
  types: (RawEnum | RawDomain)[]
  comments: RawComment[]
  alters: RawAlter[]
}

export function emptyScript(): RawScript {
  return { tables: [], indexes: [], types: [], comments: [], alters: [] }
}
