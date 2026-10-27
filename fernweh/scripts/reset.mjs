import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Explicit files only; run with the app stopped.
for (const name of ['mapper.db', 'mapper.db-wal', 'mapper.db-shm']) {
  rmSync(fileURLToPath(new URL('../data/' + name, import.meta.url)), { force: true })
}
console.log('Database reset. Run npm run dev to set up again.')
