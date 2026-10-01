import type { Project } from '@forge/core'

import { describeError } from '../../lib/describe-error.ts'
import type { ProjectStorage } from '../../lib/storage/project-storage.ts'

export type SaveResult = { ok: true } | { ok: false; message: string }

/** Serializes and stores the project. Never throws. */
export function saveProject(
  storage: ProjectStorage,
  project: Project
): SaveResult {
  try {
    storage.write(JSON.stringify(project))
    return { ok: true }
  } catch (error) {
    return { ok: false, message: describeError(error) }
  }
}
