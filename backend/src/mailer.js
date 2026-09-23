import net from 'node:net';
import tls from 'node:tls';
import { store } from './store.js';

// Optional SMTP alerting. Disabled unless the user configures their own SMTP
// credentials via NT_SMTP_* environment variables. No credentials are ever read
// from anywhere else, and failures are never fatal to trading.

export function smtpConfig() {
  return {
    host: process.env.NT_SMTP_HOST || '',
    port: Number(process.env.NT_SMTP_PORT || 587),
    secure: String(process.env.NT_SMTP_SECURE || '').toLowerCase() === 'true',
    user: process.env.NT_SMTP_USER || '',
    pass: process.env.NT_SMTP_PASS || '',
    from: process.env.NT_SMTP_FROM || process.env.NT_SMTP_USER || '',
  };
}

export function smtpEnabled() {
  const c = smtpConfig();
  return Boolean(c.host && c.from);
}

// RFC 5321 dot-stuffing + CRLF normalization.
export function dotStuff(text) {
  return String(text).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

export function buildMessage({ from, to, subject, text }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    `Date: ${new Date().toUTCString()}`,
  ];
  return `${headers.join('\r\n')}\r\n\r\n${dotStuff(text)}\r\n`;
}

class SmtpClient {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.buffer = '';
    this.waiters = [];
  }

  _onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let idx;
    while ((idx = this.buffer.indexOf('\r\n')) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      if (/^\d{3}-/.test(line)) continue; // multi-line response continues
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
    }
  }

  nextLine(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SMTP timeout')), timeoutMs);
      this.waiters.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  }

  async command(line, expect) {
    this.socket.write(`${line}\r\n`);
    const res = await this.nextLine();
    const code = Number(res.slice(0, 3));
    if (expect && !expect.includes(code)) throw new Error(`SMTP ${line.split(' ')[0]} -> ${res}`);
    return res;
  }

  async connect() {
    const { host, port, secure } = this.config;
    this.socket = secure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });
    this.socket.setEncoding('utf8');
    this.socket.on('data', (c) => this._onData(c));
    await new Promise((resolve, reject) => {
      const evt = secure ? 'secureConnect' : 'connect';
      this.socket.once(evt, resolve);
      this.socket.once('error', reject);
      setTimeout(() => reject(new Error('SMTP connect timeout')), 15000).unref?.();
    });
    await this.nextLine(); // 220 greeting
    await this.command('EHLO nebulatrade.local');
    if (!secure) {
      // Opportunistic STARTTLS.
      const res = await this.command('STARTTLS', [220]);
      if (res) {
        this.socket = tls.connect({ socket: this.socket, servername: host });
        this.socket.on('data', (c) => this._onData(c));
        await new Promise((resolve, reject) => {
          this.socket.once('secureConnect', resolve);
          this.socket.once('error', reject);
        });
        await this.command('EHLO nebulatrade.local');
      }
    }
  }

  async auth() {
    const { user, pass } = this.config;
    if (!user) return;
    await this.command('AUTH LOGIN', [334]);
    await this.command(Buffer.from(user).toString('base64'), [334]);
    await this.command(Buffer.from(pass).toString('base64'), [235]);
  }

  async send({ from, to, message }) {
    await this.command(`MAIL FROM:<${from}>`, [250]);
    await this.command(`RCPT TO:<${to}>`, [250, 251]);
    await this.command('DATA', [354]);
    this.socket.write(`${message}\r\n.\r\n`);
    await this.nextLine(); // 250 queued
    await this.command('QUIT', [221]).catch(() => {});
  }

  close() {
    try {
      this.socket?.end();
    } catch {
      /* ignore */
    }
  }
}

// Send a single plaintext email. Returns true only when it was accepted.
export async function sendMail({ to, subject, text }) {
  if (!smtpEnabled() || !to) return false;
  const config = smtpConfig();
  const client = new SmtpClient(config);
  try {
    await client.connect();
    await client.auth();
    await client.send({ from: config.from, to, message: buildMessage({ from: config.from, to, subject, text }) });
    client.close();
    return true;
  } catch (err) {
    console.error('[mail] send failed:', err.message);
    try {
      client.close();
    } catch {
      /* ignore */
    }
    return false;
  }
}

// Fire-and-forget helper used by the trading logger.
export function queueUserEmail(userId, subject, text) {
  if (!smtpEnabled()) return false;
  try {
    const user = store.find('users', (u) => u.id === userId);
    if (!user?.email) return false;
    sendMail({ to: user.email, subject, text }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}
