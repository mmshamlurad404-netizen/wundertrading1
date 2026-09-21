import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = process.env.NT_DATA_DIR
  ? path.resolve(process.env.NT_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DATA_DIR = DEFAULT_DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'nebulatrade.json');

const DEFAULT_DATA = {
  users: [],
  exchanges: [],
  bots: [],
  orders: [],
  positions: [],
  logs: [],
  notifications: [],
  watchlist: [],
  strategies: [],
  signals: [],
  meta: { createdAt: Date.now(), seq: 1 },
};

// High-churn collections are capped so the JSON store stays small and fast.
// Open positions are always retained; only historical (closed) ones are trimmed.
const RETENTION = {
  logs: 4000,
  orders: 5000,
  notifications: 4000,
  signals: 2000,
};
const POSITION_HISTORY_LIMIT = 5000;

export class Store {
  constructor({ file = DB_FILE, dir = DATA_DIR } = {}) {
    this.file = file;
    this.dir = dir;
    this.data = structuredClone(DEFAULT_DATA);
    this._dirty = false;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = fs.readFileSync(this.file, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = { ...structuredClone(DEFAULT_DATA), ...parsed };
        this.trim();
      }
    } catch (err) {
      console.error('[store] failed to load db, starting fresh:', err.message);
    }
  }

  // Drop the oldest records from high-churn collections. Never removes open
  // positions so live state is preserved across the cap.
  trim() {
    for (const [collection, limit] of Object.entries(RETENTION)) {
      const list = this.data[collection];
      if (Array.isArray(list) && list.length > limit) {
        this.data[collection] = list.slice(list.length - limit);
      }
    }
    const positions = this.data.positions;
    if (Array.isArray(positions) && positions.length > POSITION_HISTORY_LIMIT) {
      const open = positions.filter((p) => p.status === 'open');
      const closed = positions.filter((p) => p.status !== 'open');
      const keep = Math.max(0, POSITION_HISTORY_LIMIT - open.length);
      this.data.positions = [...closed.slice(Math.max(0, closed.length - keep)), ...open];
    }
  }

  save() {
    try {
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
      this._dirty = false;
    } catch (err) {
      console.error('[store] failed to save db:', err.message);
    }
  }

  markDirty() {
    this._dirty = true;
  }

  flush() {
    if (this._dirty) {
      this.trim();
      this.save();
    }
  }

  // ---- generic collection helpers ----
  all(collection) {
    return this.data[collection] || [];
  }

  find(collection, predicate) {
    return this.all(collection).find(predicate);
  }

  filter(collection, predicate) {
    return this.all(collection).filter(predicate);
  }

  insert(collection, doc) {
    if (!this.data[collection]) this.data[collection] = [];
    const record = { id: this.nextId(collection), ...doc, createdAt: doc.createdAt || Date.now() };
    this.data[collection].push(record);
    this.markDirty();
    return record;
  }

  update(collection, id, patch) {
    const list = this.data[collection] || [];
    const idx = list.findIndex((d) => d.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() };
    this.markDirty();
    return list[idx];
  }

  remove(collection, id) {
    const list = this.data[collection] || [];
    const idx = list.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    this.markDirty();
    return true;
  }

  nextId(prefix) {
    const seq = this.data.meta.seq++;
    this.markDirty();
    return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
  }
}

export const store = new Store();

// periodic flush so we don't write on every single mutation
setInterval(() => store.flush(), 2000).unref();
process.on('SIGINT', () => {
  store.flush();
  process.exit(0);
});
process.on('SIGTERM', () => {
  store.flush();
  process.exit(0);
});
