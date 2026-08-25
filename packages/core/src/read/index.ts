/**
 * The read API.
 *
 * Components are forbidden from touching the database, so every read a console page
 * needs lives here. Two properties are load-bearing and neither is optional at the
 * call site:
 *
 *   1. Every row goes through `maskValues()` before it leaves this module. There is
 *      no `unmask` parameter — unmasking is `maskRow(…, { unmask: true })`, a
 *      separate and individually audited action (§3.5).
 *   2. Every read is authorization-scoped through `can()`. A row the actor may not
 *      see is absent from the result, not hidden by the UI.
 */
import { getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { auditRowsNewestFirst } from '../audit/index';
import { approvalsFor, toApprovalRecord } from '../approvals/index';
import { db } from '../db/client';
import {
  approvalVotes,
  approvals,
  auditLog,
  featureFlags,
  kycCases,
  refunds,
} from '../db/schema';
import { maskValues } from '../pii/index';
import { can } from '../policy/index';
import type { Actor, ApprovalRecord, AuditRecord } from '../types';

/**
 * Table name → drizzle table. A spec names its table as a string, and this is the
 * one place that string is resolved; an unknown name reads as empty rather than
 * throwing, so a misconfigured spec degrades to "no rows" instead of a 500.
 */
const TABLES: Readonly<Record<string, SQLiteTable>> = {
  audit_log: auditLog,
  approvals,
  approval_votes: approvalVotes,
  kyc_cases: kycCases,
  refunds,
  feature_flags: featureFlags,
};

export function isKnownTable(table: string): boolean {
  return table in TABLES;
}

function primaryKeyValue(row: Record<string, unknown>): string {
  const id = row['id'] ?? row['key'];
  return id === undefined || id === null ? '' : String(id);
}

/**
 * Row attributes the policy is allowed to see. Passing the whole row would hand PII
 * to the policy module and make `can()` depend on data it has no business reading;
 * these are the fields rules actually threshold on.
 */
const POLICY_ATTRS = ['status', 'riskScore', 'amountCents', 'environment', 'enabled'] as const;

function policyAttrs(row: Record<string, unknown>): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const field of POLICY_ATTRS) {
    if (field in row) attrs[field] = row[field];
  }
  return attrs;
}

function readable(actor: Actor, table: string, row: Record<string, unknown>): boolean {
  return can(actor, 'record.read', {
    type: table,
    id: primaryKeyValue(row),
    attrs: policyAttrs(row),
  }).allowed;
}

function selectAll(table: string): Array<Record<string, unknown>> {
  const target = TABLES[table];
  if (!target) return [];
  // Selecting the column map keeps the camelCase field names the specs and the UI
  // use, rather than the snake_case the database stores.
  return db().select(getTableColumns(target)).from(target).all() as Array<Record<string, unknown>>;
}

export function listRows<T extends Record<string, unknown>>(table: string, actor: Actor): T[] {
  return selectAll(table)
    .filter((row) => readable(actor, table, row))
    .map((row) => maskValues(table, row) as T);
}

export function getRow<T extends Record<string, unknown>>(
  table: string,
  id: string,
  actor: Actor,
): T | undefined {
  const row = selectAll(table).find((candidate) => primaryKeyValue(candidate) === id);
  if (!row || !readable(actor, table, row)) return undefined;
  return maskValues(table, row) as T;
}

/** Newest first. Requires an auditor-capable role; scoped by can() like everything else. */
export function listAuditRows(actor: Actor): AuditRecord[] {
  if (!can(actor, 'audit.view', { type: 'audit_log', id: '*' }).allowed) return [];
  return auditRowsNewestFirst().map((row) => ({
    seq: row.seq,
    occurredAt: row.occurredAt,
    actorEmail: row.actorEmail,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    decision: row.decision,
    ...(row.decisionReason === null ? {} : { decisionReason: row.decisionReason }),
    ...(row.diff === null ? {} : { diff: row.diff }),
    prevHash: row.prevHash,
    hash: row.hash,
  }));
}

export function listApprovals(
  resourceType: string,
  resourceId: string,
  actor: Actor,
): ApprovalRecord[] {
  const decision = can(actor, 'record.read', { type: resourceType, id: resourceId });
  if (!decision.allowed) return [];
  return approvalsFor(resourceType, resourceId).map(toApprovalRecord);
}
