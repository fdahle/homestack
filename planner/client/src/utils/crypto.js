const PBKDF2_ITERATIONS = 310_000
const SALT_PREFIX       = 'planner-v1:'

export async function deriveKey(password, username) {
  const enc      = new TextEncoder()
  const keyMat   = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  const salt     = enc.encode(SALT_PREFIX + username)
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
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
