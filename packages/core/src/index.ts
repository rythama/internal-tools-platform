/**
 * Public contract of @itp/core. These signatures are normative and seeded before
 * implementation so that independent sessions can build against them in parallel.
 *
 * Implementations live in ./policy, ./audit, ./pii, ./approvals.
 */
export type Role = 'kyc_reviewer' | 'kyc_approver' | 'refund_agent'
  | 'refund_approver' | 'flag_admin' | 'auditor' | 'admin';

export interface Actor {
  sub: string;
  email: string;
  roles: Role[];
  /** Time-boxed grants that permit unmasking specific PII classes. */
  unmaskGrants?: ReadonlyArray<{ resourceType: string; expiresAt: string }>;
}

export interface Resource {
  type: string;
  id: string;
  /** Attributes the policy may read, e.g. amountCents for approval thresholds. */
  attrs?: Readonly<Record<string, unknown>>;
}

export type Decision =
  | { allowed: true; reason: string }
  /** Denials carry a reason so they are auditable and debuggable. */
  | { allowed: false; reason: string };

/**
 * The single authorization choke point. Pure and total: no I/O, never throws.
 * Deny-by-default — an action with no matching rule returns { allowed: false }.
 */
export declare function can(actor: Actor, action: string, resource: Resource): Decision;

/**
 * Executes `mutate` and writes its audit record in ONE transaction. If the audit
 * write fails the mutation rolls back. There is deliberately no way to mutate a
 * domain table through this package without producing an audit row.
 *
 * Denied attempts are also audited, with decision: 'deny'.
 */
export declare function withAudit<T>(args: {
  actor: Actor;
  action: string;
  resource: Resource;
  diff?: Record<string, unknown>;
  mutate: (tx: unknown) => T;
}): T;

/** Walks the chain from genesis; returns the seq of the first broken link. */
export declare function verifyAuditChain(): { ok: true } | { ok: false; brokenAtSeq: number };

/**
 * Masks columns classified in schema.ts `piiColumns` unless the actor holds a
 * matching unmask grant. Calling with `unmask: true` emits its own audit event.
 */
export declare function maskRow<T extends Record<string, unknown>>(
  table: keyof typeof import('./db/schema.js').piiColumns,
  row: T,
  actor: Actor,
  opts?: { unmask?: boolean },
): T;

/** Maker-checker. Returns the approval record; applies the action once satisfied. */
export declare function requestApproval(args: {
  actor: Actor;
  /** Spec action key, e.g. 'approve'. Identifies WHAT is being requested. */
  action: string;
  /**
   * Permission checked via can() before the request is recorded, e.g. 'kyc.approve'.
   * Separate from `action` because a spec action carries both, and core does not read
   * specs. Without this, core cannot authorize a request without re-deriving the
   * mapping it has no access to.
   */
  permission: string;
  resource: Resource;
  payload: Record<string, unknown>;
  requiredApprovals: number;
  disallowSelfApproval: boolean;
}): { approvalId: number; state: 'pending' };

export declare function castVote(args: {
  actor: Actor;
  approvalId: number;
  vote: 'approve' | 'reject';
  note?: string;
}): { state: 'pending' | 'approved' | 'rejected' | 'applied' };

/* ------------------------------------------------------------- tool specs */

export interface ToolSpec {
  key: string;
  title: string;
  description: string;
  /** Roles that may see this tool in the console at all. */
  visibleTo: Role[];
  queue: {
    table: string;
    columns: Array<{ field: string; label: string; width?: number }>;
    filters?: Array<{ field: string; label: string; options: string[] }>;
    defaultSort?: { field: string; dir: 'asc' | 'desc' };
    /** Optional SLA badge driven by a timestamp column. */
    sla?: { dueField: string };
  };
  detail: { sections: Array<{ label: string; fields: string[] }> };
  actions: Array<{
    key: string;
    label: string;
    /** Checked via can() before the action is offered or executed. */
    permission: string;
    intent: 'neutral' | 'positive' | 'destructive';
    approval?: { requiredApprovals: number; disallowSelfApproval: boolean };
    /** Optional: only require approval above a threshold, e.g. refunds > $500. */
    approvalThreshold?: { field: string; gt: number };
  }>;
}

/* --------------------------------------------------------- denial channel */

/**
 * Thrown by any function in this package when `can()` denies. The denial is audited
 * (decision: 'deny') BEFORE this is thrown, so the audit trail records attempts, not
 * just successes.
 *
 * Added because `withAudit()` returns `T` and therefore had no way to signal a denial
 * to its caller — a gap found by the session that had to build against this contract,
 * not by its author.
 */
export declare class PolicyDeniedError extends Error {
  readonly decision: Decision & { allowed: false };
  constructor(decision: Decision & { allowed: false });
}

/* -------------------------------------------------------------- read API */

/**
 * Reads. These exist because ARCHITECTURE.md forbids components from touching the
 * database, and a queue, a detail page, an approvals panel and an audit view are all
 * reads — so a contract of mutations alone is unimplementable. That omission was an
 * error in the original contract.
 *
 * THE LOAD-BEARING PROPERTY: every function here applies `maskRow()` before returning.
 * Masking is not optional at the call site and there is no `unmask` parameter on these
 * functions — an unmask is a separate, individually audited action. A read API that
 * lets the caller choose whether to mask is a read API through which PII leaks.
 *
 * Each is also authorization-scoped: rows the actor may not see are absent from the
 * result, not merely hidden by the UI.
 */
export declare function listRows<T extends Record<string, unknown>>(
  table: string,
  actor: Actor,
): T[];

export declare function getRow<T extends Record<string, unknown>>(
  table: string,
  id: string,
  actor: Actor,
): T | undefined;

export interface AuditRecord {
  seq: number;
  occurredAt: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  decision: 'allow' | 'deny';
  decisionReason?: string;
  /** Field-level before/after. PII values appear here hashed, never in clear (§3.5). */
  diff?: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

/** Newest first. Requires an auditor-capable role; scoped by can() like everything else. */
export declare function listAuditRows(actor: Actor): AuditRecord[];

export interface ApprovalRecord {
  approvalId: number;
  action: string;
  resourceType: string;
  resourceId: string;
  state: 'pending' | 'approved' | 'rejected' | 'applied' | 'expired';
  requestedBy: string;
  requestedAt: string;
  requiredApprovals: number;
  votes: Array<{ voterSub: string; vote: 'approve' | 'reject'; note?: string; votedAt: string }>;
}

export declare function listApprovals(
  resourceType: string,
  resourceId: string,
  actor: Actor,
): ApprovalRecord[];

/**
 * True when this package ships a real implementation rather than declarations.
 * The console feature-detects on this rather than on the presence of `can`, so that
 * a partial implementation — mutations landed, reads not yet — is visible instead of
 * silently serving stub reads alongside real writes.
 */
export declare const CORE_IMPLEMENTED: boolean;
