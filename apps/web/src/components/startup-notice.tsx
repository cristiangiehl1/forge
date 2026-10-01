import { forgeStore, useForgeStore } from '../hooks/use-forge-store.ts'

export function StartupNotice() {
  const notice = useForgeStore((state) => state.notice)
  if (!notice) return null

  if (notice.kind === 'unavailable') {
    return (
      <div role='alert' className='banner banner--warning'>
        Browser storage is unavailable ({notice.message}). Your changes will not
        be saved.
      </div>
    )
  }

  return (
    <div role='alert' className='banner banner--error'>
      <p>
        The saved project could not be read, so it was left untouched. Nothing
        will be saved until you start a new project.
      </p>
      <ul>
        {notice.errors.slice(0, 5).map((error) => (
          <li key={`${error.path}:${error.message}`}>
            {error.path ? `${error.path}: ` : ''}
            {error.message}
          </li>
        ))}
      </ul>
      <button
        type='button'
        onClick={() => forgeStore.getState().startNewProject()}>
        Start a new project
      </button>
    </div>
  )
}
