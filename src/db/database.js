const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'bot.db');

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    whatsapp_number TEXT NOT NULL UNIQUE,
    config          TEXT DEFAULT '{}',
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id  INTEGER NOT NULL,
    phone      TEXT NOT NULL,
    items      TEXT NOT NULL,
    total      REAL NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id  INTEGER NOT NULL,
    phone      TEXT NOT NULL,
    state      TEXT,
    context    TEXT DEFAULT '{}',
    paused     INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (tenant_id, phone),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  CREATE TABLE IF NOT EXISTS menu_cache (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id  INTEGER NOT NULL,
    name       TEXT NOT NULL,
    price      REAL NOT NULL,
    category   TEXT,
    available  INTEGER NOT NULL DEFAULT 1,
    loaded_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );
`);

const tenantCount = db.prepare('SELECT COUNT(*) AS n FROM tenants').get().n;
if (tenantCount === 0) {
  db.prepare(`
    INSERT INTO tenants (name, whatsapp_number, active)
    VALUES (?, ?, 1)
  `).run('Restaurante Demo', process.env.DEMO_TENANT_NUMBER || '+56900000000');
  console.log('[db] Tenant demo creado.');
}

module.exports = db;
