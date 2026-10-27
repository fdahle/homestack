const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validUsername, validPassword, validDbId, isValidPushEndpoint } = require('./validate')

test('validUsername accepts allowed names', () => {
  assert.ok(validUsername('alice'))
  assert.ok(validUsername('a_b-c1'))
  assert.ok(validUsername('abc'))           // min length 3
  assert.ok(validUsername('a'.repeat(32)))  // max length 32
})

test('validUsername rejects invalid names', () => {
  assert.ok(!validUsername('ab'))                 // too short
  assert.ok(!validUsername('a'.repeat(33)))       // too long
  assert.ok(!validUsername('Alice'))              // uppercase
  assert.ok(!validUsername('has space'))
  assert.ok(!validUsername('emoji😀name'))
  assert.ok(!validUsername(''))
  assert.ok(!validUsername(undefined))
})

test('validPassword enforces a 12-char minimum', () => {
  assert.ok(validPassword('123456789012'))
  assert.ok(!validPassword('short'))
  assert.ok(!validPassword('elevenchars'))   // 11 chars
  assert.ok(!validPassword(12345678901234))  // not a string
  assert.ok(!validPassword(undefined))
})

test('validDbId only accepts a lowercase UUID', () => {
  assert.ok(validDbId('0f8fad5b-d9cb-469f-a165-70867728950e'))
  assert.ok(!validDbId('x/../_users'))                              // path traversal
  assert.ok(!validDbId('0f8fad5b-d9cb-469f-a165-70867728950e/../x'))
  assert.ok(!validDbId('0F8FAD5B-D9CB-469F-A165-70867728950E'))     // uppercase
  assert.ok(!validDbId('alice'))
  assert.ok(!validDbId(''))
  assert.ok(!validDbId(null))
})

test('isValidPushEndpoint accepts the real push services', () => {
  assert.ok(isValidPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'))
  assert.ok(isValidPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/xyz'))
  assert.ok(isValidPushEndpoint('https://web.push.apple.com/QGx'))
  assert.ok(isValidPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=1'))
})

test('isValidPushEndpoint rejects SSRF-prone / malformed endpoints', () => {
  assert.ok(!isValidPushEndpoint('http://fcm.googleapis.com/x'))     // not https
  assert.ok(!isValidPushEndpoint('https://fcm.googleapis.com:8443/x')) // non-default port
  assert.ok(!isValidPushEndpoint('https://fcm.googleapis.com.evil.com/x'))
  assert.ok(!isValidPushEndpoint('https://evilpush.services.mozilla.com.attacker.io/x'))
  assert.ok(!isValidPushEndpoint('https://example.com/x'))
  assert.ok(!isValidPushEndpoint('https://localhost/x'))
  assert.ok(!isValidPushEndpoint('https://127.0.0.1/x'))
  assert.ok(!isValidPushEndpoint('https://[::1]/x'))
  assert.ok(!isValidPushEndpoint('https://169.254.169.254/latest/meta-data')) // cloud metadata
  assert.ok(!isValidPushEndpoint('not a url'))
  assert.ok(!isValidPushEndpoint(''))
})
