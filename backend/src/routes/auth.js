import express from 'express';
import { store } from '../store.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  signPending2fa,
  verifyPending2fa,
  authMiddleware,
} from '../auth.js';
import { createAccount, STARTING_BALANCE } from '../trading.js';
import { encryptSecret, decryptSecret } from '../secret.js';
import { generateSecret, verifyTotp, otpauthUrl } from '../totp.js';

const router = express.Router();

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    plan: u.plan || 'free',
    createdAt: u.createdAt,
    twoFactorEnabled: Boolean(u.totpEnabled),
  };
}

function decryptTotp(user) {
  if (!user?.totpSecret) return null;
  return decryptSecret(user.totpSecret);
}

router.post('/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const exists = store.find('users', (u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (exists) return res.status(409).json({ error: 'An account with this email already exists' });

  const user = store.insert('users', {
    email: String(email).toLowerCase(),
    name: name || String(email).split('@')[0],
    passwordHash: hashPassword(password),
    plan: 'pro-trial',
  });
  createAccount(user.id, { exchange: 'paper', label: 'Paper Wallet', mode: 'demo' });
  store.insert('watchlist', { userId: user.id, symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'] });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const user = store.find('users', (u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.totpEnabled) {
    return res.json({ requires2fa: true, pendingToken: signPending2fa(user), user: publicUser(user) });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

// Second step of login when the account has TOTP 2FA enabled.
router.post('/login/2fa', (req, res) => {
  const { pendingToken, code } = req.body || {};
  const pending = pendingToken ? verifyPending2fa(pendingToken) : null;
  if (!pending) return res.status(401).json({ error: 'Two-factor session expired, please sign in again' });
  const user = store.find('users', (u) => u.id === pending.sub);
  if (!user || !user.totpEnabled) return res.status(401).json({ error: 'Invalid two-factor account' });
  const secret = decryptTotp(user);
  if (!secret || !verifyTotp(secret, code)) {
    return res.status(401).json({ error: 'Invalid authentication code' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

// Begin TOTP enrolment: returns the shared secret and an otpauth:// URI for the
// authenticator app. Nothing is enforced until /2fa/enable confirms a code.
router.post('/2fa/setup', authMiddleware, (req, res) => {
  const user = store.find('users', (u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.totpEnabled) return res.status(409).json({ error: 'Two-factor authentication is already enabled' });
  const secret = generateSecret();
  store.update('users', user.id, { totpPendingSecret: encryptSecret(secret) });
  res.json({ secret, otpauthUrl: otpauthUrl({ secret, label: user.email, issuer: 'NebulaTrade' }) });
});

router.post('/2fa/enable', authMiddleware, (req, res) => {
  const user = store.find('users', (u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.totpEnabled) return res.status(409).json({ error: 'Two-factor authentication is already enabled' });
  const secret = decryptSecret(user.totpPendingSecret);
  if (!secret) return res.status(400).json({ error: 'Start two-factor setup first' });
  const { code } = req.body || {};
  if (!verifyTotp(secret, code)) return res.status(401).json({ error: 'Invalid authentication code' });
  const updated = store.update('users', user.id, {
    totpSecret: encryptSecret(secret),
    totpPendingSecret: null,
    totpEnabled: true,
  });
  res.json({ ok: true, user: publicUser(updated) });
});

// Disabling requires the account password; when 2FA is active a valid code is
// also required so a stolen session alone cannot turn protection off.
router.post('/2fa/disable', authMiddleware, (req, res) => {
  const user = store.find('users', (u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.totpEnabled) return res.status(400).json({ error: 'Two-factor authentication is not enabled' });
  const { password, code } = req.body || {};
  if (!password || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Password is incorrect' });
  }
  const secret = decryptTotp(user);
  if (secret && !verifyTotp(secret, code)) {
    return res.status(401).json({ error: 'Invalid authentication code' });
  }
  const updated = store.update('users', user.id, {
    totpSecret: null,
    totpPendingSecret: null,
    totpEnabled: false,
  });
  res.json({ ok: true, user: publicUser(updated) });
});

router.get('/me', authMiddleware, (req, res) => {
  const user = store.find('users', (u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

router.patch('/profile', authMiddleware, (req, res) => {
  const user = store.find('users', (u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { name, email } = req.body || {};
  const patch = {};
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return res.status(400).json({ error: 'Name cannot be empty' });
    patch.name = trimmed.slice(0, 80);
  }
  if (email !== undefined) {
    const next = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    const clash = store.find('users', (u) => u.id !== user.id && u.email.toLowerCase() === next);
    if (clash) return res.status(409).json({ error: 'An account with this email already exists' });
    patch.email = next;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  const updated = store.update('users', user.id, patch);
  res.json({ user: publicUser(updated) });
});

router.post('/password', authMiddleware, (req, res) => {
  const user = store.find('users', (u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  store.update('users', user.id, { passwordHash: hashPassword(newPassword) });
  res.json({ ok: true });
});

export default router;
