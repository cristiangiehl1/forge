export const NEW_TABLE_ID_CHOICES = ['integer', 'uuid', 'none'] as const

/** What a new table starts with: a generated `id` column of this kind, or nothing. */
export type NewTableId = (typeof NEW_TABLE_ID_CHOICES)[number]

export interface AppSettings {
  newTableId: NewTableId
}

export const DEFAULT_SETTINGS: AppSettings = { newTableId: 'integer' }

const isChoice = (value: unknown): value is NewTableId =>
  (NEW_TABLE_ID_CHOICES as readonly unknown[]).includes(value)

/** Settings are a convenience, never a reason to fail: anything odd is the default. */
export function parseSettings(input: unknown): AppSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return DEFAULT_SETTINGS
  }
  const { newTableId } = input as Record<string, unknown>
  return isChoice(newTableId) ? { newTableId } : DEFAULT_SETTINGS
}
