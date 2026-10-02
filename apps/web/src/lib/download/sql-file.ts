/** What the DDL is saved as: the project has no name of its own yet. */
export const SQL_FILE_NAME = 'forge-schema.sql'

/** The script as a file: its name and its content, as UTF-8 text. */
export function sqlFile(sql: string, name: string = SQL_FILE_NAME) {
  return {
    name,
    blob: new Blob([sql], { type: 'application/sql;charset=utf-8' }),
  }
}

/** Hands a file to the browser's download: a temporary link, released at once. */
export function saveFile(file: { name: string; blob: Blob }): void {
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
