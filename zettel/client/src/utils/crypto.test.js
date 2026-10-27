import { describe, it, expect } from 'vitest'
import {
  deriveKey, encryptField, decryptField,
  encryptBytes, decryptBytes, isEncryptedBlob,
  deriveKek, generateDekBytes, importDek, exportDekBytes, wrapDek, unwrapDek,
} from './crypto.js'

// Web Crypto + btoa/atob are available as globals in modern Node.
const SALT = btoa('0123456789abcdef') // 16 bytes, base64

describe('field encryption', () => {
  it('round-trips text through encrypt/decrypt', async () => {
    const key = await deriveKey('correct horse battery staple', SALT)
    const blob = await encryptField(key, 'hello, world')
    expect(blob).not.toContain('hello')
    expect(await decryptField(key, blob)).toBe('hello, world')
  })

  it('produces a different ciphertext each time (random IV)', async () => {
    const key = await deriveKey('correct horse battery staple', SALT)
    const a = await encryptField(key, 'same text')
    const b = await encryptField(key, 'same text')
    expect(a).not.toBe(b)
    expect(await decryptField(key, a)).toBe('same text')
    expect(await decryptField(key, b)).toBe('same text')
  })

  it('fails to decrypt with the wrong key', async () => {
    const k1 = await deriveKey('password-one-aaaa', SALT)
    const k2 = await deriveKey('password-two-bbbb', SALT)
    const blob = await encryptField(k1, 'secret')
    await expect(decryptField(k2, blob)).rejects.toBeTruthy()
  })

  it('derives different keys for different salts', async () => {
    const k1 = await deriveKey('same password here', btoa('aaaaaaaaaaaaaaaa'))
    const k2 = await deriveKey('same password here', btoa('bbbbbbbbbbbbbbbb'))
    const blob = await encryptField(k1, 'secret')
    await expect(decryptField(k2, blob)).rejects.toBeTruthy()
  })
})

describe('byte encryption', () => {
  it('round-trips binary data', async () => {
    const key = await deriveKey('a-very-long-password', SALT)
    const data = new Uint8Array([1, 2, 3, 4, 250, 0, 128])
    const enc = await encryptBytes(key, data.buffer)
    const dec = await decryptBytes(key, enc.buffer)
    expect(Array.from(dec)).toEqual(Array.from(data))
  })
})

describe('envelope encryption (DEK / KEK)', () => {
  const PW1 = 'first-password-aaaa'
  const PW2 = 'second-password-bbbb'

  it('wraps and unwraps a DEK with the same password', async () => {
    const kek = await deriveKek(PW1, SALT)
    const dekBytes = generateDekBytes()
    expect(dekBytes.length).toBe(32)
    const wrapped = await wrapDek(kek, dekBytes)
    const unwrapped = await unwrapDek(kek, wrapped)
    expect(Array.from(unwrapped)).toEqual(Array.from(dekBytes))
  })

  it('cannot unwrap the DEK with the wrong password', async () => {
    const kek1 = await deriveKek(PW1, SALT)
    const kek2 = await deriveKek(PW2, SALT)
    const wrapped = await wrapDek(kek1, generateDekBytes())
    await expect(unwrapDek(kek2, wrapped)).rejects.toBeTruthy()
  })

  it('keeps notes readable across a password change (re-wrap only)', async () => {
    // Set up: a DEK encrypts a note; the DEK is wrapped under PW1.
    const kek1     = await deriveKek(PW1, SALT)
    const dekBytes = generateDekBytes()
    const dek      = await importDek(dekBytes)
    const note     = await encryptField(dek, 'sensitive note body')
    const wrapped1 = await wrapDek(kek1, dekBytes)

    // Password change: re-wrap the SAME DEK under PW2 (notes are NOT touched).
    const kek2      = await deriveKek(PW2, SALT)
    const reExported = await exportDekBytes(dek)
    const wrapped2  = await wrapDek(kek2, reExported)

    // Old wrapper no longer works; new password unwraps the same DEK and decrypts.
    await expect(unwrapDek(kek1, wrapped2)).rejects.toBeTruthy()
    const dek2 = await importDek(await unwrapDek(kek2, wrapped2))
    expect(await decryptField(dek2, note)).toBe('sensitive note body')

    // Sanity: the original wrapper still unwraps the same key too.
    const dek1 = await importDek(await unwrapDek(kek1, wrapped1))
    expect(await decryptField(dek1, note)).toBe('sensitive note body')
  })
})

describe('isEncryptedBlob', () => {
  it('recognises encrypted blobs and rejects plaintext', async () => {
    const key = await deriveKey('a-very-long-password', SALT)
    expect(isEncryptedBlob(await encryptField(key, 'x'))).toBe(true)
    expect(isEncryptedBlob('just text')).toBe(false)
    expect(isEncryptedBlob('{"not":"a blob"}')).toBe(false)
    expect(isEncryptedBlob(null)).toBe(false)
  })
})
