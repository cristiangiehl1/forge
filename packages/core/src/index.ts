export type { Dialect } from './dialects/dialect.ts'
export { postgres } from './dialects/postgres.ts'
export type { ParseError, ParseResult } from './project/parse-project.ts'
export { parseProject } from './project/parse-project.ts'
export type { Project } from './project/project.ts'
export { CURRENT_FORMAT_VERSION, createProject } from './project/project.ts'
export {
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
} from './schema/operations.ts'
export { sameTypeShape, userTypeIdsOf } from './schema/type-shape.ts'
export type {
  Column,
  ColumnId,
  ColumnRef,
  ColumnType,
  DomainType,
  EnumType,
  Index,
  IndexId,
  IndexMethod,
  Relationship,
  RelationshipId,
  Schema,
  SimpleColumnKind,
  Table,
  TableId,
  TypeId,
  UserType,
} from './schema/types.ts'
export {
  GENERATED_COLUMN_KINDS,
  INDEX_METHODS,
  MAX_NUMERIC_PRECISION,
  MAX_VARCHAR_LENGTH,
  SIMPLE_COLUMN_KINDS,
} from './schema/types.ts'
export type { Issue, IssueCode } from './schema/validate.ts'
export { checkRelationship, validate } from './schema/validate.ts'
export type {
  DdlStatement,
  GenerateResult,
} from './sql/generate/generate-ddl.ts'
export { generateDdl } from './sql/generate/generate-ddl.ts'
