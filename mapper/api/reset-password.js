// One-off password reset: removes the account so the next visit shows the setup screen.
// Usage: docker compose exec app node api/reset-password.js   (or: npm run reset-password)
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), quiet: true })

const { default: db } = await import('./db.js')
const { changes } = db.prepare('DELETE FROM users').run()
db.close()
console.log(changes
  ? 'Account removed. Open the app now and set a new password — whoever opens it first can claim it.'
  : 'No account exists; the app is already waiting for setup.')
