import type { ProjectStorage } from '../storage/project-storage.ts'
import type { AppSettings } from './settings.ts'
import { DEFAULT_SETTINGS, parseSettings } from './settings.ts'

/** Reads the settings. Never throws: unreadable or malformed means the default. */
export function loadSettings(storage: ProjectStorage): AppSettings {
  try {
    const raw = storage.read()
    return raw === null ? DEFAULT_SETTINGS : parseSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** Saves the settings. Never throws: losing a preference is not worth an error. */
export function saveSettings(
  storage: ProjectStorage,
  settings: AppSettings
): void {
  try {
    storage.write(JSON.stringify(settings))
  } catch {
    // Nothing to do: the choice still holds until the page is closed.
  }
}
