/**
 * Database handle for @itp/core.
 *
 * SQLite via better-sqlite3, Postgres-shaped schema (ARCHITECTURE.md §3.1). No
 * migration tool: §3.1 forbids introducing one for a prototype, so the DDL below is
 * the hand-written mirror of `schema.ts` and is applied idempotently on first open.
 * A column added to `schema.ts` without a matching line here fails the schema-parity
 * test rather than at runtime.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

export function databasePath(): string {
  return process.env['ITP_DB_PATH'] ?? resolve(REPO_ROOT, 'itp.db');
}

/**
 * Append-only enforcement lives in the database, not only in the API surface: there
 * is no repository function that updates or deletes an audit row, and if one were
 * ever written these triggers would reject it. Named so a test can drop them to
 * simulate an attacker with direct database access.
 */
const AUDIT_GUARD_TRIGGERS = ['audit_log_no_update', 'audit_log_no_delete'] as const;

const DDL = `
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_sub TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  actor_roles TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  decision_reason TEXT,
  diff TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS audit_log_seq_unique ON audit_log (seq);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  required_approvals INTEGER NOT NULL DEFAULT 1,
  disallow_self_approval INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS approval_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id INTEGER NOT NULL,
  voter_sub TEXT NOT NULL,
  vote TEXT NOT NULL,
  note TEXT,
  voted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kyc_cases (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  risk_score INTEGER NOT NULL,
  submitted_at TEXT NOT NULL,
  sla_due_at TEXT NOT NULL,
  assigned_to TEXT,
  legal_name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  tax_id TEXT NOT NULL,
  country TEXT NOT NULL,
  document_url TEXT,
  sanctions_hit INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'requested',
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  customer_email TEXT NOT NULL,
  card_last4 TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  settlement_key TEXT
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  rollout_percent INTEGER NOT NULL DEFAULT 0,
  environment TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

let connection: Database.Database | undefined;
let handle: Db | undefined;

function open(path: string): { raw: Database.Database; db: Db } {
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.exec(DDL);
  return { raw, db: drizzle(raw, { schema }) };
}

export function db(): Db {
  if (!handle) {
    const opened = open(databasePath());
    connection = opened.raw;
    handle = opened.db;
  }
  return handle;
}

/** Escape hatch for the few operations drizzle does not express (DDL, PRAGMA). */
export function raw(): Database.Database {
  db();
  if (!connection) throw new Error('database is not open');
  return connection;
}

/**
 * Test seam. Each suite gets its own in-memory database so the hash chains of
 * different tests cannot interleave — the chain is global state by construction.
 */
export function useInMemoryDatabaseForTests(): void {
  connection?.close();
  const opened = open(':memory:');
  connection = opened.raw;
  handle = opened.db;
}

/** Drops the append-only triggers. Only a tamper test has any business calling this. */
export function dropAuditGuardsForTests(): void {
  for (const trigger of AUDIT_GUARD_TRIGGERS) raw().exec(`DROP TRIGGER IF EXISTS ${trigger}`);
}

export function closeDatabase(): void {
  connection?.close();
  connection = undefined;
  handle = undefined;
}
