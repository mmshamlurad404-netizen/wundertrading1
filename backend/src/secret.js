import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.NT_DATA_DIR
  ? path.resolve(process.env.NT_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const KEY_FILE = path.join(DATA_DIR, '.secret.key');

let cachedKey = null;

function loadKey() {
  if (cachedKey) return cachedKey;
  const envKey = process.env.NT_SECRET || process.env.NEBULATRADE_SECRET;
  if (envKey) {
    cachedKey = crypto.createHash('sha256').update(String(envKey)).digest();
    return cachedKey;
  }
  try {
    if (fs.existsSync(KEY_FILE)) {
      cachedKey = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
      if (cachedKey.length === 32) return cachedKey;
    }
  } catch {
    /* fall through */
  }
  const fresh = crypto.randomBytes(32);
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, fresh.toString('base64'), { mode: 0o600 });
  } catch {
    /* in-memory only */
  }
  cachedKey = fresh;
  return cachedKey;
}

// AES-256-GCM: returns "v1.<iv>.<tag>.<ciphertext>" (all base64url)
export function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(payload) {
  if (!payload) return null;
  const parts = String(payload).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    // legacy plaintext value
    return payload;
  }
  try {
    const key = loadKey();
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const data = Buffer.from(parts[3], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function maskValue(v) {
  if (!v) return null;
  const s = String(v);
  if (s.length <= 6) return '******';
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
}

export function last4(v) {
  if (!v) return 'demo';
  const s = String(v);
  return s.length >= 4 ? s.slice(-4) : s;
}
