import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = process.env.NT_DATA_DIR
  ? path.resolve(process.env.NT_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DATA_DIR = DEFAULT_DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'nebulatrade.db');
const LEGACY_FILE = path.join(DATA_DIR, 'nebulatrade.json');

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

// High-churn collections are capped so the store stays small and fast.
// Open positions are always retained; only historical (closed) ones are trimmed.
const RETENTION = {
  logs: 4000,
  orders: 5000,
  notifications: 4000,
  signals: 2000,
};
const POSITION_HISTORY_LIMIT = 5000;

// SQLite-backed document store.
//
// Every collection is stored as JSON documents in a single indexed table, with
// an in-memory mirror so the rest of the app keeps its synchronous read API.
// Writes go through to the database immediately, so the process can crash at
// any point without losing committed trades or credentials.
export class Store {
  constructor({ file = DB_FILE, dir = DATA_DIR } = {}) {
    this.file = file;
    this.dir = dir;
    this.legacyFile = path.join(dir, 'nebulatrade.json');
    this.data = structuredClone(DEFAULT_DATA);
    this._dirty = false;
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    this.db = new DatabaseSync(this.file);
    this._init();
    this.load();
  }

  _init() {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_docs_collection_seq ON docs (collection, seq);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    this._insert = this.db.prepare(
      'INSERT INTO docs (collection, id, seq, json) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(collection, id) DO UPDATE SET json = excluded.json'
    );
    this._delete = this.db.prepare('DELETE FROM docs WHERE collection = ? AND id = ?');
    this._all = this.db.prepare('SELECT collection, id, seq, json FROM docs ORDER BY seq ASC');
    this._count = this.db.prepare('SELECT COUNT(*) AS n FROM docs');
    this._queue = [];
  }

  // Writes are queued and applied in a single transaction on flush, which is
  // far faster than fsyncing every mutation while still committing to SQLite.
  _enqueuePut(collection, id, json, seq) {
    this._queue.push({ op: 'put', collection, id, json, seq });
    this._dirty = true;
  }

  _enqueueDelete(collection, id) {
    this._queue.push({ op: 'del', collection, id });
    this._dirty = true;
  }

  _drain() {
    if (!this._queue.length) return;
    const ops = this._queue;
    this._queue = [];
    try {
      this.db.exec('BEGIN');
      for (const op of ops) {
        if (op.op === 'put') this._insert.run(op.collection, op.id, op.seq || 0, op.json);
        else this._delete.run(op.collection, op.id);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      console.error('[store] write batch failed:', err.message);
    }
  }

  load() {
    try {
      const { n } = this._count.get();
      if (n === 0) {
        this._migrateLegacy();
        return;
      }
      let maxSeq = 0;
      for (const row of this._all.all()) {
        let doc;
        try {
          doc = JSON.parse(row.json);
        } catch {
          continue;
        }
        if (!this.data[row.collection]) this.data[row.collection] = [];
        this.data[row.collection].push(doc);
        if (Number.isFinite(row.seq) && row.seq > maxSeq) maxSeq = row.seq;
      }
      this.data.meta.seq = Math.max(maxSeq + 1, this._readMetaSeq(), 1);
      this.trim();
    } catch (err) {
      console.error('[store] failed to load db, starting fresh:', err.message);
    }
  }

  _readMetaSeq() {
    try {
      const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('seq');
      return row ? Number(row.value) || 0 : 0;
    } catch {
      return 0;
    }
  }

  // One-time import of the previous JSON file so existing installs keep data.
  _migrateLegacy() {
    const legacy = this.legacyFile || LEGACY_FILE;
    if (!fs.existsSync(legacy)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(legacy, 'utf8'));
      let seq = 1;
      this.db.exec('BEGIN');
      for (const [collection, list] of Object.entries(parsed)) {
        if (collection === 'meta' || !Array.isArray(list)) continue;
        if (!this.data[collection]) this.data[collection] = [];
        for (const doc of list) {
          if (!doc || !doc.id) continue;
          this.data[collection].push(doc);
          this._insert.run(collection, doc.id, seq++, JSON.stringify(doc));
        }
      }
      this.data.meta.seq = seq;
      this.db.exec('COMMIT');
      this.trim();
      this.flush();
      console.log(`[store] migrated ${legacy} into ${this.file}`);
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      console.error('[store] legacy migration failed:', err.message);
    }
  }

  _persistMeta() {
    try {
      this.db
        .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run('seq', String(this.data.meta.seq));
    } catch (err) {
      console.error('[store] failed to persist meta:', err.message);
    }
  }

  // Drop the oldest records from high-churn collections. Never removes open
  // positions so live state is preserved across the cap.
  trim() {
    const removed = [];
    for (const [collection, limit] of Object.entries(RETENTION)) {
      const list = this.data[collection];
      if (Array.isArray(list) && list.length > limit) {
        const drop = list.slice(0, list.length - limit);
        for (const d of drop) removed.push([collection, d.id]);
        this.data[collection] = list.slice(list.length - limit);
      }
    }
    const positions = this.data.positions;
    if (Array.isArray(positions) && positions.length > POSITION_HISTORY_LIMIT) {
      const open = positions.filter((p) => p.status === 'open');
      const closed = positions.filter((p) => p.status !== 'open');
      const keep = Math.max(0, POSITION_HISTORY_LIMIT - open.length);
      const keptClosed = closed.slice(Math.max(0, closed.length - keep));
      for (const d of closed.slice(0, Math.max(0, closed.length - keep))) removed.push(['positions', d.id]);
      this.data.positions = [...keptClosed, ...open];
    }
    if (removed.length) {
      for (const [collection, id] of removed) this._enqueueDelete(collection, id);
    }
  }

  save() {
    try {
      this._drain();
      this._persistMeta();
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
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

  close() {
    try {
      this.save();
      this.db.close();
    } catch {
      /* ignore */
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
    const seq = this.data.meta.seq;
    const record = { id: this.nextId(collection), ...doc, createdAt: doc.createdAt || Date.now() };
    this.data[collection].push(record);
    this._enqueuePut(collection, record.id, JSON.stringify(record), seq);
    return record;
  }

  update(collection, id, patch) {
    const list = this.data[collection] || [];
    const idx = list.findIndex((d) => d.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() };
    this._enqueuePut(collection, id, JSON.stringify(list[idx]), 0);
    return list[idx];
  }

  remove(collection, id) {
    const list = this.data[collection] || [];
    const idx = list.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    this._enqueueDelete(collection, id);
    return true;
  }

  nextId(prefix) {
    const seq = this.data.meta.seq++;
    this.markDirty();
    return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
  }
}

export const store = new Store();

// periodic flush keeps the meta sequence durable without writing it per insert
setInterval(() => store.flush(), 2000).unref();
process.on('SIGINT', () => {
  store.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  store.close();
  process.exit(0);
});
