/**
 * TEMPORARY in-memory stand-in for the @itp/core runtime (Session 1).
 *
 * Every function here implements the signature declared in packages/core/src/index.ts
 * and nothing more. It is deliberately small and deliberately not a second
 * implementation of the platform: no SQLite, no drizzle, no schema knowledge. When
 * Session 1 merges, `./index.ts` picks up the real functions and this file is dead
 * code that can be deleted in one commit.
 *
 * State lives in module scope, so it resets whenever the dev server rebuilds. That is
 * fine for a shell demo and is another reason not to grow this file.
 */
import { createHash } from 'node:crypto';
import type { Actor, Decision, Resource } from '@itp/core';
import type { AuditRowView } from '@itp/ui';
import { stubCan } from './policy-stub';

export type StubRow = Record<string, unknown>;

export class PolicyDeniedError extends Error {
  constructor(public readonly decision: Decision) {
    super(decision.reason);
    this.name = 'PolicyDeniedError';
  }
}

type ApprovalRecord = {
  approvalId: number;
  action: string;
  resourceType: string;
  resourceId: string;
  payload: Record<string, unknown>;
  state: 'pending' | 'approved' | 'rejected' | 'applied' | 'expired';
  requestedBy: string;
  requestedAt: string;
  requiredApprovals: number;
  disallowSelfApproval: boolean;
  votes: Array<{ voterSub: string; vote: 'approve' | 'reject'; note?: string; votedAt: string }>;
};

type Store = {
  tables: Map<string, StubRow[]>;
  pii: Map<string, Record<string, 'high' | 'low'>>;
  audit: AuditRowView[];
  approvals: ApprovalRecord[];
  clock: number;
};

const GENESIS = '0'.repeat(64);

const store: Store = {
  tables: new Map(),
  pii: new Map(),
  audit: [],
  approvals: [],
  clock: Date.parse('2025-01-01T09:00:00.000Z'),
};

/** Deterministic clock: fixture demos and tests should not depend on wall time. */
function nextTimestamp(): string {
  store.clock += 1000;
  return new Date(store.clock).toISOString();
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
  return `{${entries.join(',')}}`;
}

export function seedStubTable(
  table: string,
  rows: readonly StubRow[],
  pii: Record<string, 'high' | 'low'> = {},
): void {
  store.tables.set(table, rows.map((row) => ({ ...row })));
  store.pii.set(table, pii);
}

export function stubListRows(table: string): StubRow[] {
  return (store.tables.get(table) ?? []).map((row) => ({ ...row }));
}

export function stubGetRow(table: string, id: string): StubRow | undefined {
  const row = (store.tables.get(table) ?? []).find((candidate) => String(candidate['id']) === id);
  return row ? { ...row } : undefined;
}

export function stubMaskRow<T extends Record<string, unknown>>(
  table: string,
  row: T,
  actor: Actor,
  opts?: { unmask?: boolean },
): T {
  const classification = store.pii.get(table) ?? {};
  const grant = (actor.unmaskGrants ?? []).some(
    (candidate) => candidate.resourceType === table && Date.parse(candidate.expiresAt) > Date.now(),
  );

  if (opts?.unmask) {
    if (!grant) {
      throw new PolicyDeniedError({ allowed: false, reason: `no unmask grant for ${table}` });
    }
    appendAudit({
      actor,
      action: 'pii.unmask',
      resource: { type: table, id: String(row['id'] ?? 'unknown') },
      decision: 'allow',
      decisionReason: 'actor holds an unmask grant for this resource type',
      diff: { fields: Object.keys(classification) },
    });
    return { ...row };
  }

  const masked: Record<string, unknown> = { ...row };
  for (const [field, level] of Object.entries(classification)) {
    const value = masked[field];
    if (typeof value !== 'string') continue;
    masked[field] = level === 'high' ? '[redacted]' : partialMask(value);
  }
  return masked as T;
}

function partialMask(value: string): string {
  const at = value.indexOf('@');
  if (at > 0) return `${value.slice(0, 1)}***${value.slice(at)}`;
  if (value.length <= 4) return `**** ${value}`;
  return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
}

function appendAudit(args: {
  actor: Actor;
  action: string;
  resource: Resource;
  decision: 'allow' | 'deny';
  decisionReason: string;
  diff?: Record<string, unknown> | undefined;
}): void {
  const prev = store.audit[store.audit.length - 1];
  const prevHash = prev?.hash ?? GENESIS;
  const row = {
    seq: (prev?.seq ?? 0) + 1,
    occurredAt: nextTimestamp(),
    actorEmail: args.actor.email,
    action: args.action,
    resourceType: args.resource.type,
    resourceId: args.resource.id,
    decision: args.decision,
    decisionReason: args.decisionReason,
    ...(args.diff ? { diff: args.diff } : {}),
    prevHash,
  };
  const hash = createHash('sha256').update(`${prevHash}${canonical(row)}`).digest('hex');
  store.audit.push({ ...row, hash });
}

/**
 * Runs the mutation and records it. The real implementation does this in one SQLite
 * transaction; here there is no database, so "atomic" degrades to "the audit row is
 * written by the same function that performs the mutation, or not at all".
 */
export function stubWithAudit<T>(args: {
  actor: Actor;
  action: string;
  resource: Resource;
  diff?: Record<string, unknown>;
  mutate: (tx: unknown) => T;
}): T {
  const decision = stubCan(args.actor, args.action, args.resource);
  const entry = {
    actor: args.actor,
    action: args.action,
    resource: args.resource,
    diff: args.diff,
  };
  if (!decision.allowed) {
    appendAudit({ ...entry, decision: 'deny', decisionReason: decision.reason });
    throw new PolicyDeniedError(decision);
  }
  const result = args.mutate(undefined);
  appendAudit({ ...entry, decision: 'allow', decisionReason: decision.reason });
  return result;
}

export function stubVerifyAuditChain(): { ok: true } | { ok: false; brokenAtSeq: number } {
  let prevHash = GENESIS;
  for (const row of store.audit) {
    const { hash, ...rest } = row;
    const expected = createHash('sha256').update(`${prevHash}${canonical(rest)}`).digest('hex');
    if (expected !== hash || rest.prevHash !== prevHash) return { ok: false, brokenAtSeq: row.seq };
    prevHash = hash;
  }
  return { ok: true };
}

export function stubListAuditRows(): AuditRowView[] {
  return [...store.audit];
}

export function stubRequestApproval(args: {
  actor: Actor;
  action: string;
  resource: Resource;
  payload: Record<string, unknown>;
  requiredApprovals: number;
  disallowSelfApproval: boolean;
}): { approvalId: number; state: 'pending' } {
  const approvalId = store.approvals.length + 1;
  // Not routed through stubWithAudit: `requestApproval` is handed the *tool action
  // key* ("close"), while can() is handed the action's *permission*
  // ("record.review"). Only the spec knows the mapping, and the stub does not read
  // specs — so the caller checks the permission and this records the request.
  appendAudit({
    actor: args.actor,
    action: `${args.action}.request`,
    resource: args.resource,
    decision: 'allow',
    decisionReason: 'approval requested; the action itself still needs a second signature',
    diff: { approvalId, payload: args.payload },
  });
  store.approvals.push({
    approvalId,
    action: args.action,
    resourceType: args.resource.type,
    resourceId: args.resource.id,
    payload: args.payload,
    state: 'pending',
    requestedBy: args.actor.sub,
    requestedAt: nextTimestamp(),
    requiredApprovals: args.requiredApprovals,
    disallowSelfApproval: args.disallowSelfApproval,
    votes: [],
  });
  return { approvalId, state: 'pending' };
}

export function stubCastVote(args: {
  actor: Actor;
  approvalId: number;
  vote: 'approve' | 'reject';
  note?: string;
}): { state: 'pending' | 'approved' | 'rejected' | 'applied' } {
  const approval = store.approvals.find((candidate) => candidate.approvalId === args.approvalId);
  if (!approval) throw new Error(`unknown approval ${args.approvalId}`);
  const resource: Resource = { type: approval.resourceType, id: approval.resourceId };

  if (approval.disallowSelfApproval && approval.requestedBy === args.actor.sub) {
    appendAudit({
      actor: args.actor,
      action: 'approval.vote',
      resource,
      decision: 'deny',
      decisionReason: 'requester may not approve their own request (four-eyes)',
      diff: { approvalId: approval.approvalId },
    });
    throw new PolicyDeniedError({
      allowed: false,
      reason: 'requester may not approve their own request (four-eyes)',
    });
  }

  return stubWithAudit({
    actor: args.actor,
    action: 'approval.vote',
    resource,
    diff: { approvalId: approval.approvalId, vote: args.vote },
    mutate: () => {
      approval.votes.push({
        voterSub: args.actor.sub,
        vote: args.vote,
        ...(args.note ? { note: args.note } : {}),
        votedAt: nextTimestamp(),
      });
      if (args.vote === 'reject') {
        approval.state = 'rejected';
      } else if (approval.votes.filter((vote) => vote.vote === 'approve').length >= approval.requiredApprovals) {
        approval.state = 'applied';
      }
      return { state: approval.state as 'pending' | 'approved' | 'rejected' | 'applied' };
    },
  });
}

export function stubListApprovals(resourceType: string, resourceId: string): ApprovalRecord[] {
  return store.approvals
    .filter((approval) => approval.resourceType === resourceType && approval.resourceId === resourceId)
    .map((approval) => ({ ...approval, votes: [...approval.votes] }));
}

export function stubSelfApprovalBlocked(approvalId: number, actorSub: string): boolean {
  const approval = store.approvals.find((candidate) => candidate.approvalId === approvalId);
  return Boolean(approval?.disallowSelfApproval && approval.requestedBy === actorSub);
}

/** Test seam: the module-level store is otherwise process-wide. */
export function resetStubStore(): void {
  store.tables.clear();
  store.pii.clear();
  store.audit = [];
  store.approvals = [];
  store.clock = Date.parse('2025-01-01T09:00:00.000Z');
}

export function tamperWithAuditRowForTests(seq: number, patch: Partial<AuditRowView>): void {
  const index = store.audit.findIndex((row) => row.seq === seq);
  const existing = store.audit[index];
  if (existing) store.audit[index] = { ...existing, ...patch };
}
