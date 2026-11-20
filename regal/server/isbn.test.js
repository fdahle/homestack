import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isbn13, isbnList, looksLikeIsbn, toIsbn10 } from './isbn.js';

test('ISBNs in any form become ISBN-13', () => {
  assert.equal(isbn13('9783551551672'), '9783551551672');
  assert.equal(isbn13('978-3-551-55167-2'), '9783551551672');
  assert.equal(isbn13(' 978 3 551 55167 2 '), '9783551551672');
  assert.equal(isbn13('3-551-55167-7'), '9783551551672');
  assert.equal(isbn13('3551551677'), '9783551551672');
  // ISBN-10 with X as its check digit
  assert.equal(isbn13('080442957X'), '9780804429573');
  assert.equal(isbn13('080442957x'), '9780804429573');
});

test('wrong check digits and other barcodes are not ISBNs', () => {
  assert.equal(isbn13('9783551551673'), null);
  assert.equal(isbn13('3551551676'), null);
  assert.equal(isbn13('4006381333931'), null); // an EAN, but not a book
  assert.equal(isbn13('X551551677'), null);
  assert.equal(isbn13(''), null);
  assert.equal(isbn13(null), null);
});

test('ISBN-10 only for 978 numbers', () => {
  assert.equal(toIsbn10('9783551551672'), '3551551677');
  assert.equal(toIsbn10('9780804429573'), '080442957X');
  assert.equal(toIsbn10('9791032305690'), null);
});

test('lists of ISBNs', () => {
  assert.deepEqual(isbnList(['3551551677', '978-3-551-55167-2', 'nonsense', '9780804429573']), ['9783551551672', '9780804429573']);
  assert.deepEqual(isbnList('978-3-551-55167-2, 080442957X'), ['9783551551672', '9780804429573']);
  assert.deepEqual(isbnList(''), []);
});

test('a search that is an ISBN', () => {
  assert.ok(looksLikeIsbn('978-3-551-55167-2'));
  assert.ok(looksLikeIsbn('080442957X'));
  assert.ok(!looksLikeIsbn('1984'));
  assert.ok(!looksLikeIsbn('Harry Potter'));
});
