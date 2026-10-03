import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dataDir } from './paths.js';

fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'opus.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS routers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    password_enc TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY,
    router_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price INTEGER,
    validity TEXT,
    uptime_hint TEXT,
    limit_uptime TEXT,
    rate_limit TEXT,
    on_login TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    synced_at TEXT,
    UNIQUE (router_id, name)
  );

  CREATE TABLE IF NOT EXISTS resellers (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    hmp_code TEXT NOT NULL,
    hmp_name TEXT NOT NULL,
    router_id INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock (
    reseller_id INTEGER NOT NULL,
    profile_id INTEGER NOT NULL,
    remaining INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (reseller_id, profile_id)
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY,
    reseller_id INTEGER NOT NULL,
    router_id INTEGER NOT NULL,
    profile_id INTEGER,
    profile_name TEXT NOT NULL,
    code TEXT NOT NULL,
    price INTEGER,
    validity TEXT,
    limit_uptime TEXT NOT NULL,
    comment TEXT NOT NULL,
    sale_date TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_type TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sales_date ON sales (sale_date);
  CREATE INDEX IF NOT EXISTS idx_sales_reseller ON sales (reseller_id, sale_date);
`);
