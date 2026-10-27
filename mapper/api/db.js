import { DatabaseSync } from 'node:sqlite'
import { accessSync, constants, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeDatabase } from './schema.js'

const filename = process.env.MAPPER_DB_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'mapper.db')
let db
try {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true })
    // SQLite also creates -wal/-shm files next to the database, so the directory itself must be writable.
    accessSync(dirname(filename), constants.W_OK)
  }
  db = new DatabaseSync(filename)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000')
} catch (err) {
  const uid = process.getuid?.()
  console.error(`Cannot open the database ${filename}: ${err.message}
The directory ${dirname(filename)} must be writable by the user running the app${uid == null ? '' : ` (uid ${uid})`}.
With Docker Compose, run this next to docker-compose.yml and start again:  sudo chown -R 1000:1000 data`)
  process.exit(1)
}
initializeDatabase(db)
export default db
