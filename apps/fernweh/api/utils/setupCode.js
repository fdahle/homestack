import { randomInt } from 'node:crypto'
import db from '../db.js'
import { proxySecret, sameString } from '../middleware/auth.js'

// Until the first password is set, whoever reaches the page first could choose it and own the map.
// The set-up code proves access to the server instead: it is printed to the log on start, kept in
// memory only, and a new one comes with every start. Instances with a password never get one.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O or 1/I, as it is read off a log by eye
const LENGTH = 10 // 50 bits; the sign-in rate limit allows a few hundred guesses per 15 minutes
let code = null

// Makes a code (once) while there is no password and the server's login is off. Returns it, or null.
export function announceSetupCode() {
  if (proxySecret() || db.prepare('SELECT 1 FROM users LIMIT 1').get()) return null
  if (!code) {
    code = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
    console.log(`No password set yet. Set-up code for the first visit: ${code}`)
  }
  return code
}

export function checkSetupCode(given) {
  const expected = announceSetupCode()
  return Boolean(expected) && typeof given === 'string' && sameString(given.trim().toUpperCase(), expected)
}

// One use: after the password is set, the code is gone.
export function forgetSetupCode() { code = null }
