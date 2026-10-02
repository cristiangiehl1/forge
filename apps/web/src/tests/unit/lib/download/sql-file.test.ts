import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SQL_FILE_NAME, sqlFile } from '../../../../lib/download/sql-file.ts'

describe('sqlFile', () => {
  it('is named forge-schema.sql', () => {
    assert.equal(SQL_FILE_NAME, 'forge-schema.sql')
    assert.equal(sqlFile('x').name, 'forge-schema.sql')
  })

  it('holds the script as it is, as UTF-8 text', async () => {
    const sql = 'CREATE TABLE "café" (\n  "id" integer\n);\n'
    const { blob } = sqlFile(sql)
    assert.equal(await blob.text(), sql)
    assert.equal(blob.type, 'application/sql;charset=utf-8')
  })

  it('keeps the bytes of non-ASCII names intact', async () => {
    const { blob } = sqlFile('COMMENT ON TABLE "t" IS \'ação – 日本\';\n')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    assert.equal(
      new TextDecoder().decode(bytes),
      'COMMENT ON TABLE "t" IS \'ação – 日本\';\n'
    )
  })
})
