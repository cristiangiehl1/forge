import type { Project } from '@forge/core'
import { useMutation } from '@tanstack/react-query'

import { localStorageProject } from '../../lib/storage/default-storage.ts'
import { saveProject } from './save-project.ts'

export function useSaveProject() {
  return useMutation({
    mutationFn: async (project: Project) => {
      const result = saveProject(localStorageProject, project)
      if (!result.ok) throw new Error(result.message)
    },
  })
}
