/** A comment that is empty or only spaces counts as none, in the UI and the DDL. */
export function hasComment(text: string | undefined): text is string {
  return text !== undefined && text.trim() !== ''
}
