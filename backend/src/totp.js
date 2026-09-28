import crypto from 'node:crypto';

// RFC 4648 base32 (no padding) as used by authenticator apps.
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 20 random bytes -> 160-bit secret, the authenticator-app default.
export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function hotp(secret, counter, digits = 6) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

export function totpAt(secret, { step = 30, digits = 6, t = Date.now() } = {}) {
  return hotp(secret, Math.floor(t / 1000 / step), digits);
}

// Verifies a code allowing +/- `window` time steps for clock drift.
export function verifyTotp(secret, code, { step = 30, digits = 6, window = 1, t = Date.now() } = {}) {
  if (!secret || !code) return false;
  const target = String(code).replace(/\s/g, '');
  if (!/^\d+$/.test(target)) return false;
  const counter = Math.floor(t / 1000 / step);
  for (let i = -window; i <= window; i += 1) {
    if (counter + i < 0) continue;
    const candidate = hotp(secret, counter + i, digits);
    if (candidate.length === target.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(target))) {
      return true;
    }
  }
  return false;
}

export function otpauthUrl({ secret, label = 'user', issuer = 'NebulaTrade', digits = 6, step = 30 }) {
  const enc = encodeURIComponent;
  return (
    `otpauth://totp/${enc(issuer)}:${enc(label)}` +
    `?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=${digits}&period=${step}`
  );
}

export function currentStep(step = 30, t = Date.now()) {
  return Math.floor(t / 1000 / step);
}
