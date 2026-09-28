import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Encode,
  base32Decode,
  generateSecret,
  hotp,
  totpAt,
  verifyTotp,
  otpauthUrl,
} from '../src/totp.js';

test('base32 round-trips arbitrary bytes', () => {
  const buf = Buffer.from('NebulaTrade-2FA');
  const encoded = base32Encode(buf);
  assert.match(encoded, /^[A-Z2-7]+$/);
  assert.deepEqual(base32Decode(encoded), buf);
});

test('base32 decode ignores padding and separators', () => {
  const secret = generateSecret();
  assert.deepEqual(base32Decode(secret), base32Decode(secret.replace(/(.{4})/g, '$1 ')));
});

test('generated secrets are 160 bits of base32', () => {
  const secret = generateSecret();
  assert.equal(secret.length, 32);
  assert.equal(base32Decode(secret).length, 20);
});

test('hotp matches the RFC 4226 test vectors', () => {
  // Appendix D uses the ASCII secret "12345678901234567890".
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676'];
  for (let counter = 0; counter < expected.length; counter += 1) {
    assert.equal(hotp(secret, counter), expected[counter]);
  }
});

test('verifyTotp accepts the current code and rejects wrong codes', () => {
  const secret = generateSecret();
  const code = totpAt(secret);
  assert.equal(verifyTotp(secret, code), true);
  const wrong = code === '000000' ? '111111' : '000000';
  assert.equal(verifyTotp(secret, wrong), false);
});

test('verifyTotp tolerates one step of clock drift in each direction', () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  const step = 30_000;
  assert.equal(verifyTotp(secret, totpAt(secret, { t: now - step }), { t: now }), true);
  assert.equal(verifyTotp(secret, totpAt(secret, { t: now + step }), { t: now }), true);
  assert.equal(verifyTotp(secret, totpAt(secret, { t: now - 3 * step }), { t: now }), false);
});

test('verifyTotp rejects malformed input without throwing', () => {
  const secret = generateSecret();
  assert.equal(verifyTotp(secret, ''), false);
  assert.equal(verifyTotp(secret, 'abcdef'), false);
  assert.equal(verifyTotp(secret, null), false);
  assert.equal(verifyTotp(null, '123456'), false);
});

test('otpauth URL carries issuer, label and parameters', () => {
  const secret = generateSecret();
  const url = otpauthUrl({ secret, label: 'trader@example.com', issuer: 'NebulaTrade' });
  assert.ok(url.startsWith('otpauth://totp/NebulaTrade:trader%40example.com?'));
  assert.ok(url.includes(`secret=${secret}`));
  assert.ok(url.includes('issuer=NebulaTrade'));
  assert.ok(url.includes('digits=6'));
  assert.ok(url.includes('period=30'));
});
