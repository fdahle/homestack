import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeDatabase } from './schema.js'

const filename = process.env.MAPPER_DB_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'mapper.db')
if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
const db = new DatabaseSync(filename)
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000')
initializeDatabase(db)
export default db
