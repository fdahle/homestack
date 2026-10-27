const PBKDF2_ITERATIONS = 310_000

// Derives the AES-GCM key from the password and a random per-user salt. The salt
// is generated server-side at registration and stored (in plaintext — salts are
// not secret) on the user doc, then handed to the client at login. The server
// never sees the password or the derived key. A unique random salt per user means
// identical passwords yield different keys and defeats precomputed/rainbow tables.
// `saltB64` is the base64-encoded random salt.
export async function deriveKey(password, saltB64) {
  const enc      = new TextEncoder()
  const keyMat   = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  const salt     = b64ToBuf(saltB64)
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ── Envelope encryption ───────────────────────────────────────────────────────
// Notes are encrypted with a random Data Encryption Key (DEK). The DEK itself is
// wrapped (encrypted) with a Key Encryption Key (KEK) derived from the password.
// Because the DEK never changes, a password change only re-wraps it — notes are
// never re-encrypted, so there is no bulk-rewrite / data-loss window.
//
// The KEK is derived exactly like the old direct key (PBKDF2 over the password +
// per-user salt); it's just used to wrap the DEK instead of encrypting notes.
export const deriveKek = deriveKey

// A fresh 256-bit DEK as raw bytes.
export function generateDekBytes() {
  return crypto.getRandomValues(new Uint8Array(32))
}

// Import raw DEK bytes as an AES-GCM key for note encryption. Extractable so it
// can be re-exported and re-wrapped on password change.
export function importDek(rawBytes) {
  return crypto.subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
}

export async function exportDekBytes(dek) {
  return new Uint8Array(await crypto.subtle.exportKey('raw', dek))
}

// Wrap/unwrap the DEK as a field blob (reusing AES-GCM field encryption over the
// base64-encoded raw key bytes). Returns / accepts the JSON blob string stored
// server-side as the user's `encWrappedDek`.
export async function wrapDek(kek, dekBytes) {
  return encryptField(kek, bufToB64(dekBytes))
}

export async function unwrapDek(kek, wrappedBlob) {
  return b64ToBuf(await decryptField(kek, wrappedBlob))
}

export async function encryptField(key, plaintext) {
  const iv         = crypto.getRandomValues(new Uint8Array(12))
  const enc        = new TextEncoder()
  const cipherBuf  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  return JSON.stringify({
    v:  1,
    iv: bufToB64(iv),
    ct: bufToB64(new Uint8Array(cipherBuf)),
  })
}

export async function decryptField(key, blob) {
  const { iv, ct } = JSON.parse(blob)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(iv) },
    key,
    b64ToBuf(ct),
  )
  return new TextDecoder().decode(plain)
}

// Encrypt raw bytes (e.g. an attachment blob). Returns a Uint8Array shaped as
// [12-byte IV][ciphertext] so the IV travels with the data.
export async function encryptBytes(key, arrayBuffer) {
  const iv        = crypto.getRandomValues(new Uint8Array(12))
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, arrayBuffer)
  const out       = new Uint8Array(iv.length + cipherBuf.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(cipherBuf), iv.length)
  return out
}

export async function decryptBytes(key, arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  const iv    = bytes.slice(0, 12)
  const ct    = bytes.slice(12)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new Uint8Array(plain)
}

export function isEncryptedBlob(value) {
  if (typeof value !== 'string') return false
  try {
    const obj = JSON.parse(value)
    return obj?.v === 1 && typeof obj.ct === 'string'
  } catch {
    return false
  }
}

function bufToB64(buf) {
  let binary = ''
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i])
  return btoa(binary)
}

function b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}
