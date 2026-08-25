/**
 * The contract's type surface, factored out of index.ts so the implementation
 * modules can import it without importing the barrel (and the cycle that creates).
 * index.ts re-exports every name here; the public shape is unchanged.
 */
export type Role =
  | 'kyc_reviewer'
  | 'kyc_approver'
  | 'refund_agent'
  | 'refund_approver'
  | 'flag_admin'
  | 'auditor'
  | 'admin';

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

/**
 * Thrown by any function in this package when `can()` denies. The denial is audited
 * (decision: 'deny') BEFORE this is thrown, so the audit trail records attempts, not
 * just successes.
 */
export class PolicyDeniedError extends Error {
  readonly decision: Decision & { allowed: false };

  constructor(decision: Decision & { allowed: false }) {
    super(decision.reason);
    this.name = 'PolicyDeniedError';
    this.decision = decision;
  }
}
