/**
 * Table name → drizzle table, and which of those tables a tool is allowed to write.
 *
 * A spec names its table as a string; this is the one place that string is resolved,
 * so the read API and the write API cannot disagree about what `kyc_cases` means.
 */
import { getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
  approvalVotes,
  approvals,
  auditLog,
  featureFlags,
  kycCases,
  refunds,
} from './schema';

const TABLES: Readonly<Record<string, SQLiteTable>> = {
  audit_log: auditLog,
  approvals,
  approval_votes: approvalVotes,
  kyc_cases: kycCases,
  refunds,
  feature_flags: featureFlags,
};

/**
 * Owned by packages/core and off limits to the generic write path. The audit chain
 * and the approval state machine are the two things a tool must not be able to
 * rewrite while claiming to be "just updating a row".
 */
const PLATFORM_TABLES: readonly string[] = ['audit_log', 'approvals', 'approval_votes'];

export function isKnownTable(table: string): boolean {
  return table in TABLES;
}

export function isPlatformTable(table: string): boolean {
  return PLATFORM_TABLES.includes(table);
}

/** Unknown names resolve to undefined so a misconfigured spec degrades, not throws. */
export function tableFor(table: string): SQLiteTable | undefined {
  return TABLES[table];
}

export function primaryKeyValue(row: Record<string, unknown>): string {
  const id = row['id'] ?? row['key'];
  return id === undefined || id === null ? '' : String(id);
}

/** The single-column primary key of a domain table: `id`, or `key` for flags. */
export function primaryKeyColumn(target: SQLiteTable) {
  const columns = getTableColumns(target) as Record<string, SQLiteTable['_']['columns'][string]>;
  return columns['id'] ?? columns['key'];
}

export function columnNames(target: SQLiteTable): string[] {
  return Object.keys(getTableColumns(target));
}
