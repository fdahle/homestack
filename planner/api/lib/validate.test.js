const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validUsername, validPassword, isValidPushEndpoint } = require('./validate')

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

test('isValidPushEndpoint accepts public HTTPS endpoints', () => {
  assert.ok(isValidPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'))
  assert.ok(isValidPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/xyz'))
})

test('isValidPushEndpoint rejects SSRF-prone / malformed endpoints', () => {
  assert.ok(!isValidPushEndpoint('http://fcm.googleapis.com/x'))     // not https
  assert.ok(!isValidPushEndpoint('https://localhost/x'))
  assert.ok(!isValidPushEndpoint('https://127.0.0.1/x'))
  assert.ok(!isValidPushEndpoint('https://10.0.0.5/x'))
  assert.ok(!isValidPushEndpoint('https://192.168.1.10/x'))
  assert.ok(!isValidPushEndpoint('https://172.16.0.1/x'))
  assert.ok(!isValidPushEndpoint('https://169.254.169.254/latest/meta-data')) // cloud metadata
  assert.ok(!isValidPushEndpoint('not a url'))
  assert.ok(!isValidPushEndpoint(''))
})
