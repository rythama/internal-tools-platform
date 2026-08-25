/**
 * Append-only, hash-chained audit, written in the same transaction as the mutation
 * it records (ARCHITECTURE.md §3.4).
 *
 * The atomicity claim is not decoration: `withAudit` opens one better-sqlite3
 * transaction, runs the caller's mutation inside it, and appends the audit row
 * inside it. If the audit insert throws, the mutation rolls back with it — asserted
 * in `audit.test.ts` by installing a trigger that rejects audit inserts.
 */
import { desc } from 'drizzle-orm';
import { now } from '../clock';
import { db, type Db } from '../db/client';
import { auditLog, piiColumns } from '../db/schema';
import { can, rolesSnapshot } from '../policy/index';
import { PolicyDeniedError, type Actor, type Resource } from '../types';
import { GENESIS_HASH, chainHash, hashPiiValue } from './hash';

/** The drizzle transaction handle, as handed to `mutate`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Reader that works both inside and outside a transaction. */
type Reader = Db | Tx;

/**
 * Exactly the fields that are hashed. The database's autoincrement `id` is
 * deliberately excluded: it is an insertion artefact, not a fact about the event,
 * and including it would make the chain unverifiable after any dump-and-reload.
 */
type ChainPayload = {
  seq: number;
  occurredAt: string;
  actorSub: string;
  actorEmail: string;
  actorRoles: string[];
  action: string;
  resourceType: string;
  resourceId: string;
  decision: 'allow' | 'deny';
  decisionReason: string | null;
  diff: Record<string, unknown> | null;
  prevHash: string;
};

function tail(reader: Reader): { seq: number; hash: string } {
  const [last] = reader
    .select({ seq: auditLog.seq, hash: auditLog.hash })
    .from(auditLog)
    .orderBy(desc(auditLog.seq))
    .limit(1)
    .all();
  return last ?? { seq: 0, hash: GENESIS_HASH };
}

/**
 * A diff may carry the very values §3.5 masks at the read boundary, so anything
 * classified as PII for this resource type is hashed before it reaches the log.
 * The hash still supports "did this field change", which is what a diff is for.
 */
function redactDiff(
  resourceType: string,
  diff: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!diff) return null;
  const classification: Record<string, 'high' | 'low'> =
    (piiColumns as Record<string, Record<string, 'high' | 'low'>>)[resourceType] ?? {};
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(diff)) {
    out[field] = field in classification ? hashPiiValue(value) : value;
  }
  return out;
}

export type AuditEntry = {
  actor: Actor;
  /** Audit action name. Usually the permission, but e.g. `approve.request` for a
   *  maker-checker request, where the recorded event and the checked permission
   *  are genuinely different things. */
  action: string;
  resource: Resource;
  decision: 'allow' | 'deny';
  decisionReason: string;
  diff?: Record<string, unknown> | undefined;
};

/** Appends one row to the chain using the caller's transaction. Never updates. */
export function appendAudit(tx: Reader, entry: AuditEntry): ChainPayload & { hash: string } {
  const previous = tail(tx);
  const payload: ChainPayload = {
    seq: previous.seq + 1,
    occurredAt: now(),
    actorSub: entry.actor.sub,
    actorEmail: entry.actor.email,
    actorRoles: rolesSnapshot(entry.actor),
    action: entry.action,
    resourceType: entry.resource.type,
    resourceId: entry.resource.id,
    decision: entry.decision,
    decisionReason: entry.decisionReason,
    diff: redactDiff(entry.resource.type, entry.diff),
    prevHash: previous.hash,
  };
  const hash = chainHash(payload.prevHash, payload);
  tx.insert(auditLog)
    .values({
      seq: payload.seq,
      occurredAt: payload.occurredAt,
      actorSub: payload.actorSub,
      actorEmail: payload.actorEmail,
      actorRoles: payload.actorRoles,
      action: payload.action,
      resourceType: payload.resourceType,
      resourceId: payload.resourceId,
      decision: payload.decision,
      decisionReason: payload.decisionReason,
      diff: payload.diff,
      prevHash: payload.prevHash,
      hash,
    })
    .run();
  return { ...payload, hash };
}

/** Records a denial on its own chain link, then hands the caller the error to throw. */
export function auditDenial(entry: Omit<AuditEntry, 'decision'>): PolicyDeniedError {
  db().transaction((tx) => appendAudit(tx, { ...entry, decision: 'deny' }));
  return new PolicyDeniedError({ allowed: false, reason: entry.decisionReason });
}

export function withAudit<T>(args: {
  actor: Actor;
  action: string;
  resource: Resource;
  diff?: Record<string, unknown>;
  mutate: (tx: unknown) => T;
}): T {
  const decision = can(args.actor, args.action, args.resource);
  const entry = {
    actor: args.actor,
    action: args.action,
    resource: args.resource,
    diff: args.diff,
  };

  if (!decision.allowed) {
    throw auditDenial({ ...entry, decisionReason: decision.reason });
  }

  return db().transaction((tx) => {
    const result = args.mutate(tx);
    appendAudit(tx, { ...entry, decision: 'allow', decisionReason: decision.reason });
    return result;
  });
}

/** Walks the chain from genesis; returns the seq of the first broken link. */
export function verifyAuditChain(): { ok: true } | { ok: false; brokenAtSeq: number } {
  const rows = db().select().from(auditLog).orderBy(auditLog.seq).all();
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;

  for (const row of rows) {
    // A missing row is tampering too: the chain of hashes still links, but the
    // sequence does not, which is exactly what a deletion looks like.
    if (row.seq !== expectedSeq) return { ok: false, brokenAtSeq: row.seq };
    const payload: ChainPayload = {
      seq: row.seq,
      occurredAt: row.occurredAt,
      actorSub: row.actorSub,
      actorEmail: row.actorEmail,
      actorRoles: row.actorRoles,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      decision: row.decision,
      decisionReason: row.decisionReason ?? null,
      diff: row.diff ?? null,
      prevHash: row.prevHash,
    };
    if (row.prevHash !== prevHash) return { ok: false, brokenAtSeq: row.seq };
    if (chainHash(prevHash, payload) !== row.hash) return { ok: false, brokenAtSeq: row.seq };
    prevHash = row.hash;
    expectedSeq += 1;
  }

  return { ok: true };
}

/** Newest first, for the audit view. Authorization is applied by the read API. */
export function auditRowsNewestFirst() {
  return db().select().from(auditLog).orderBy(desc(auditLog.seq)).all();
}
