/** The longest script the dialog accepts. */
export const MAX_SQL_BYTES = 1024 * 1024

export const tooBig = (bytes: number): boolean => bytes > MAX_SQL_BYTES

export const describeLimit = (): string => `${MAX_SQL_BYTES / (1024 * 1024)} MB`
