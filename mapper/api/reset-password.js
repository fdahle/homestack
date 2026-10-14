// Sets a new account password and signs out every device. The account is never left unclaimed.
// Usage: docker compose exec app node api/reset-password.js   (or: npm run reset-password)
// Non-interactive: printf '%s\n' 'new password' | docker compose exec -T app node api/reset-password.js
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), quiet: true })

// Typed characters go to a muted output so the password is not echoed.
let muted = false
const output = new Writable({ write(chunk, _encoding, callback) { if (!muted) process.stdout.write(chunk); callback() } })
const rl = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY })
rl.on('SIGINT', () => process.exit(130))
const lines = rl[Symbol.asyncIterator]()
async function ask(prompt) {
  process.stdout.write(prompt)
  muted = true
  const { value } = await lines.next()
  muted = false
  process.stdout.write('\n')
  return value ?? ''
}

const password = await ask('New password (at least 12 characters): ')
const repeated = process.stdin.isTTY ? await ask('Repeat the new password: ') : password
rl.close()
if (password !== repeated) {
  console.error('The passwords do not match. Nothing was changed.')
  process.exit(1)
}
if (password.length < 12 || Buffer.byteLength(password) > 72) {
  console.error('The password must be at least 12 characters and at most 72 bytes. Nothing was changed.')
  process.exit(1)
}

const { default: db } = await import('./db.js')
const hash = await bcrypt.hash(password, 12)
// A new session version signs out every device that was logged in with the old password.
const version = randomBytes(32).toString('hex')
const user = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()
if (user) db.prepare('UPDATE users SET password_hash=?, session_version=? WHERE id=?').run(hash, version, user.id)
else db.prepare('INSERT INTO users (password_hash, session_version) VALUES (?, ?)').run(hash, version)
db.close()
console.log(user ? 'Password changed. All devices have been signed out; sign in with the new password.' : 'Account created. Sign in with the new password.')
