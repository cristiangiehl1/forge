import type { ParseError, Project } from '@forge/core'
import { parseProject } from '@forge/core'

import { describeError } from '../../lib/describe-error.ts'
import type { ProjectStorage } from '../../lib/storage/project-storage.ts'

export type LoadResult =
  | { status: 'empty' }
  | { status: 'loaded'; project: Project }
  | { status: 'invalid'; errors: ParseError[] }
  | { status: 'unavailable'; message: string }

/** Reads and validates the stored project. Never throws and never writes. */
export function loadProject(storage: ProjectStorage): LoadResult {
  let raw: string | null
  try {
    raw = storage.read()
  } catch (error) {
    return { status: 'unavailable', message: describeError(error) }
  }
  if (raw === null) return { status: 'empty' }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return {
      status: 'invalid',
      errors: [{ path: '', message: 'The stored project is not valid JSON.' }],
    }
  }

  const result = parseProject(json)
  return result.ok
    ? { status: 'loaded', project: result.project }
    : { status: 'invalid', errors: result.errors }
}
