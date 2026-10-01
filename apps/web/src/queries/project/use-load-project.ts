import { useQuery } from '@tanstack/react-query'

import { localStorageProject } from '../../lib/storage/default-storage.ts'
import { loadProject } from './load-project.ts'

/** Loads the stored project once; it never refetches on its own. */
export function useLoadProject() {
  return useQuery({
    queryKey: ['project'],
    queryFn: () => loadProject(localStorageProject),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
