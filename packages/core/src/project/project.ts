import type { DialectId, DialectOptions } from '../dialects/dialect.ts'
import type { Schema } from '../schema/types.ts'

export const CURRENT_FORMAT_VERSION = 1

/**
 * The saved document. `view` is opaque to the core: the web app puts node
 * positions and the viewport there, and the core only passes it through.
 * `dialect` and `options` say which database the DDL is written for; a project
 * saved without them is PostgreSQL.
 */
export interface Project {
  formatVersion: 1
  schema: Schema
  view: unknown
  dialect?: DialectId
  options?: DialectOptions
}

export function createProject(
  schema: Schema,
  view: unknown,
  settings: { dialect?: DialectId; options?: DialectOptions } = {}
): Project {
  const project: Project = {
    formatVersion: CURRENT_FORMAT_VERSION,
    schema,
    view,
  }
  if (settings.dialect !== undefined) project.dialect = settings.dialect
  if (settings.options && Object.keys(settings.options).length > 0) {
    project.options = settings.options
  }
  return project
}
