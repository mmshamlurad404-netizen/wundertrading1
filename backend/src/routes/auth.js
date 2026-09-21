import express from 'express';
import { store } from '../store.js';
import { hashPassword, verifyPassword, signToken, authMiddleware } from '../auth.js';
import { createAccount, STARTING_BALANCE } from '../trading.js';

const router = express.Router();

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, plan: u.plan || 'free', createdAt: u.createdAt };
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
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', authMiddleware, (req, res) => {
  const user = store.find('users', (u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

export default router;
