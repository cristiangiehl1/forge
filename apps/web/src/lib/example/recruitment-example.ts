import type { ImportMessage, Schema } from '@forge/core'
import { importSql } from '@forge/core'

import { layoutTables } from '../layout/layout-tables.ts'
import type { ProjectView } from '../project-view.ts'
import { createView } from '../project-view.ts'
import { RECRUITMENT_SQL } from './recruitment-sql.ts'

/**
 * The recruitment system's schema, read from its Oracle migrations by the same
 * importer a person would use. Ids are a counter, so it is the same every time.
 */
export function createRecruitmentExample(): {
  schema: Schema
  view: ProjectView
  warnings: ImportMessage[]
} {
  let counter = 0
  const result = importSql(RECRUITMENT_SQL, () => `rc-${++counter}`, 'oracle')
  if (result.errors.length > 0) {
    throw new Error(
      `The recruitment example does not read: ${result.errors[0]?.message}`
    )
  }
  return {
    schema: result.schema,
    view: { ...createView(), nodes: layoutTables(result.schema) },
    warnings: result.warnings,
  }
}
