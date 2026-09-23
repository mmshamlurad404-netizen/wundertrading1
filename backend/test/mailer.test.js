import test from 'node:test';
import assert from 'node:assert/strict';
import { smtpEnabled, smtpConfig, buildMessage, dotStuff, sendMail, queueUserEmail } from '../src/mailer.js';

test('SMTP is disabled without host/from', async () => {
  const saved = { ...process.env };
  delete process.env.NT_SMTP_HOST;
  delete process.env.NT_SMTP_FROM;
  assert.equal(smtpEnabled(), false);
  assert.equal(await sendMail({ to: 'a@b.io', subject: 's', text: 't' }), false);
  assert.equal(queueUserEmail('nobody', 's', 't'), false);
  Object.assign(process.env, saved);
});

test('dotStuff escapes leading dots and normalizes newlines', () => {
  assert.equal(dotStuff('.hello\r\nworld'), '..hello\r\nworld');
  assert.equal(dotStuff('a\n.b'), 'a\r\n..b');
});

test('buildMessage produces RFC822 headers plus body', () => {
  const msg = buildMessage({ from: 'bot@x.io', to: 'user@y.io', subject: 'Fill', text: 'line1\nline2' });
  assert.match(msg, /From: bot@x\.io\r\n/);
  assert.match(msg, /To: user@y\.io\r\n/);
  assert.match(msg, /Subject: Fill\r\n/);
  assert.match(msg, /Content-Type: text\/plain; charset=utf-8\r\n/);
  assert.ok(msg.endsWith('line1\r\nline2\r\n'));
});

test('smtpConfig reflects the NT_SMTP_* variables', () => {
  process.env.NT_SMTP_HOST = 'smtp.example.test';
  process.env.NT_SMTP_PORT = '465';
  process.env.NT_SMTP_SECURE = 'true';
  process.env.NT_SMTP_USER = 'u';
  process.env.NT_SMTP_PASS = 'p';
  process.env.NT_SMTP_FROM = 'from@example.test';
  const cfg = smtpConfig();
  assert.equal(cfg.host, 'smtp.example.test');
  assert.equal(cfg.port, 465);
  assert.equal(cfg.secure, true);
  assert.equal(cfg.from, 'from@example.test');
  assert.equal(smtpEnabled(), true);
  delete process.env.NT_SMTP_HOST;
  delete process.env.NT_SMTP_PORT;
  delete process.env.NT_SMTP_SECURE;
  delete process.env.NT_SMTP_USER;
  delete process.env.NT_SMTP_PASS;
  delete process.env.NT_SMTP_FROM;
});
