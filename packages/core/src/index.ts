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
  action: string;
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
