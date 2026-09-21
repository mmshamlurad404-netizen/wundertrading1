import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../src/auth.js';

test('password hashing verifies the correct password', () => {
  const hash = hashPassword('secret123');
  assert.notEqual(hash, 'secret123');
  assert.equal(verifyPassword('secret123', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
});

test('tokens round-trip the subject and email', () => {
  const token = signToken({ id: 'users_1', email: 'a@b.io' });
  const payload = verifyToken(token);
  assert.equal(payload.sub, 'users_1');
  assert.equal(payload.email, 'a@b.io');
});

test('invalid tokens verify to null instead of throwing', () => {
  assert.equal(verifyToken('not-a-token'), null);
  assert.equal(verifyToken(''), null);
});
