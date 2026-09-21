import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, maskValue, last4 } from '../src/secret.js';

test('encrypt/decrypt round-trips a secret', () => {
  const plain = 'sk-live-abcdef1234567890';
  const enc = encryptSecret(plain);
  assert.notEqual(enc, plain);
  assert.ok(enc.startsWith('v1.'));
  assert.equal(decryptSecret(enc), plain);
});

test('encryption uses a random IV so ciphertexts differ', () => {
  const a = encryptSecret('same-value');
  const b = encryptSecret('same-value');
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), decryptSecret(b));
});

test('empty values encrypt to null', () => {
  assert.equal(encryptSecret(''), null);
  assert.equal(encryptSecret(null), null);
  assert.equal(decryptSecret(null), null);
});

test('legacy plaintext decrypts as-is', () => {
  assert.equal(decryptSecret('plain-old-key'), 'plain-old-key');
});

test('tampered ciphertext fails closed to null', () => {
  const enc = encryptSecret('top-secret');
  const parts = enc.split('.');
  parts[3] = Buffer.from('tampered-payload').toString('base64url');
  assert.equal(decryptSecret(parts.join('.')), null);
});

test('maskValue hides the middle of a value', () => {
  assert.equal(maskValue('abcdef123456'), 'abc***456');
  assert.equal(maskValue('short'), '******');
  assert.equal(maskValue(null), null);
});

test('last4 returns the tail or demo fallback', () => {
  assert.equal(last4('abcdef123456'), '3456');
  assert.equal(last4('ab'), 'ab');
  assert.equal(last4(''), 'demo');
});
