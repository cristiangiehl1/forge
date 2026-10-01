import type { Schema } from '../schema/types.ts'

export const CURRENT_FORMAT_VERSION = 1

/**
 * The saved document. `view` is opaque to the core: the web app puts node
 * positions and the viewport there, and the core only passes it through.
 */
export interface Project {
  formatVersion: 1
  schema: Schema
  view: unknown
}

export function createProject(schema: Schema, view: unknown): Project {
  return { formatVersion: CURRENT_FORMAT_VERSION, schema, view }
}
