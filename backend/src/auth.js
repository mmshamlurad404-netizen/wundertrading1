import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.NT_DATA_DIR
  ? path.resolve(process.env.NT_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const JWT_KEY_FILE = path.join(DATA_DIR, '.jwt.key');
const TOKEN_TTL = '7d';

let cachedJwtSecret = null;

// Prefer an explicit JWT_SECRET. Otherwise generate a persistent random key in
// the data dir so tokens survive restarts, instead of shipping a public default.
function jwtSecret() {
  if (cachedJwtSecret) return cachedJwtSecret;
  if (process.env.JWT_SECRET) {
    cachedJwtSecret = process.env.JWT_SECRET;
    return cachedJwtSecret;
  }
  try {
    if (fs.existsSync(JWT_KEY_FILE)) {
      const existing = fs.readFileSync(JWT_KEY_FILE, 'utf8').trim();
      if (existing) {
        cachedJwtSecret = existing;
        return cachedJwtSecret;
      }
    }
  } catch {
    /* fall through to generating a new key */
  }
  const fresh = crypto.randomBytes(48).toString('base64url');
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(JWT_KEY_FILE, fresh, { mode: 0o600 });
    console.warn('[auth] JWT_SECRET not set; generated a persistent key at data/.jwt.key');
  } catch {
    console.warn('[auth] JWT_SECRET not set and data dir is not writable; tokens will reset on restart');
  }
  cachedJwtSecret = fresh;
  return cachedJwtSecret;
}

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

export function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, jwtSecret(), { expiresIn: TOKEN_TTL });
}

// Short-lived ticket handed out after a correct password when the account has
// 2FA enabled; it can only be redeemed at the second login step.
export function signPending2fa(user) {
  return jwt.sign({ sub: user.id, purpose: '2fa' }, jwtSecret(), { expiresIn: '5m' });
}

export function verifyPending2fa(token) {
  try {
    const payload = jwt.verify(token, jwtSecret());
    return payload && payload.purpose === '2fa' ? payload : null;
  } catch {
    return null;
  }
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, jwtSecret());
  } catch {
    return null;
  }
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  req.userId = payload.sub;
  next();
}
