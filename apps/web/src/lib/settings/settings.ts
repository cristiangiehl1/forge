export const NEW_TABLE_ID_CHOICES = ['integer', 'uuid', 'none'] as const

/** What a new table starts with: a generated `id` column of this kind, or nothing. */
export type NewTableId = (typeof NEW_TABLE_ID_CHOICES)[number]

export interface AppSettings {
  newTableId: NewTableId
  /** New tables also get generated `created_at` and `updated_at` columns. */
  newTableTimestamps: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  newTableId: 'integer',
  newTableTimestamps: false,
}

const isChoice = (value: unknown): value is NewTableId =>
  (NEW_TABLE_ID_CHOICES as readonly unknown[]).includes(value)

/** Settings are a convenience, never a reason to fail: anything odd is the default. */
export function parseSettings(input: unknown): AppSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return DEFAULT_SETTINGS
  }
  const { newTableId, newTableTimestamps } = input as Record<string, unknown>
  // Each field falls back on its own: a project saved before a preference
  // existed keeps the ones it has.
  return {
    newTableId: isChoice(newTableId) ? newTableId : DEFAULT_SETTINGS.newTableId,
    newTableTimestamps:
      typeof newTableTimestamps === 'boolean'
        ? newTableTimestamps
        : DEFAULT_SETTINGS.newTableTimestamps,
  }
}
