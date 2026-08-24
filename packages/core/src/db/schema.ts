/**
 * Normative data model. See docs/ARCHITECTURE.md §3.
 *
 * Two families of tables:
 *   - Platform tables (audit_log, approvals): owned by packages/core. Tools never
 *     write to these directly; they go through the core primitives.
 *   - Domain tables: owned by the tool that uses them.
 *
 * PII classification lives in `piiColumns` below and is enforced at the
 * data-access boundary, not by convention.
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/* ---------------------------------------------------------------- platform */

/**
 * Append-only, hash-chained. Written in the same transaction as the mutation
 * it records. No UPDATE or DELETE path exists for this table — enforced by
 * repository API surface and asserted in tests.
 */
export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Monotonic per-chain sequence. Gaps indicate tampering. */
  seq: integer('seq').notNull(),
  occurredAt: text('occurred_at').notNull(),
  actorSub: text('actor_sub').notNull(),
  actorEmail: text('actor_email').notNull(),
  /** Roles held at time of action — not looked up later, since roles change. */
  actorRoles: text('actor_roles', { mode: 'json' }).$type<string[]>().notNull(),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  /** Allow | Deny. Denied attempts are audited too — that is the interesting half. */
  decision: text('decision', { enum: ['allow', 'deny'] }).notNull(),
  decisionReason: text('decision_reason'),
  /** Field-level before/after. PII values are stored hashed, never in clear. */
  diff: text('diff', { mode: 'json' }).$type<Record<string, unknown>>(),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
});

/**
 * Generic maker-checker. A tool spec declares the requirement; this table and the
 * state machine in packages/core/src/approvals implement it once for all tools.
 */
export const approvals = sqliteTable('approvals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  action: text('action').notNull(),
  /** Serialized action payload, applied verbatim on approval. */
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  state: text('state', {
    enum: ['pending', 'approved', 'rejected', 'applied', 'expired'],
  }).notNull().default('pending'),
  requestedBy: text('requested_by').notNull(),
  requestedAt: text('requested_at').notNull(),
  requiredApprovals: integer('required_approvals').notNull().default(1),
  /** If true, requester may not self-approve. Four-eyes. */
  disallowSelfApproval: integer('disallow_self_approval', { mode: 'boolean' })
    .notNull().default(true),
  expiresAt: text('expires_at'),
});

export const approvalVotes = sqliteTable('approval_votes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  approvalId: integer('approval_id').notNull(),
  voterSub: text('voter_sub').notNull(),
  vote: text('vote', { enum: ['approve', 'reject'] }).notNull(),
  note: text('note'),
  votedAt: text('voted_at').notNull(),
});

/* ------------------------------------------------------------ domain: kyc */

export const kycCases = sqliteTable('kyc_cases', {
  id: text('id').primaryKey(),
  status: text('status', {
    enum: ['pending', 'in_review', 'escalated', 'approved', 'rejected'],
  }).notNull().default('pending'),
  riskScore: integer('risk_score').notNull(),
  /** Drives SLA display and queue ordering. */
  submittedAt: text('submitted_at').notNull(),
  slaDueAt: text('sla_due_at').notNull(),
  assignedTo: text('assigned_to'),

  legalName: text('legal_name').notNull(),
  dateOfBirth: text('date_of_birth').notNull(),
  taxId: text('tax_id').notNull(),
  country: text('country').notNull(),
  documentUrl: text('document_url'),
  sanctionsHit: integer('sanctions_hit', { mode: 'boolean' }).notNull().default(false),
});

/* -------------------------------------------------------- domain: refunds */

export const refunds = sqliteTable('refunds', {
  id: text('id').primaryKey(),
  status: text('status', {
    enum: ['requested', 'pending_approval', 'approved', 'rejected', 'settled'],
  }).notNull().default('requested'),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  customerEmail: text('customer_email').notNull(),
  cardLast4: text('card_last4').notNull(),
  reason: text('reason').notNull(),
  requestedAt: text('requested_at').notNull(),
  /** Idempotency key for the downstream PSP call. Unique in production. */
  settlementKey: text('settlement_key'),
});

/* -------------------------------------------------- domain: feature flags */

export const featureFlags = sqliteTable('feature_flags', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  rolloutPercent: integer('rollout_percent').notNull().default(0),
  environment: text('environment', { enum: ['dev', 'staging', 'prod'] }).notNull(),
  updatedAt: text('updated_at').notNull(),
});

/* ------------------------------------------------------------------- pii */

/**
 * Single source of truth for PII classification. The data-access layer reads
 * this — masking is never a per-tool decision.
 *
 * 'high' : masked unless the actor holds an explicit unmask grant; unmasking is audited.
 * 'low'  : partially masked (e.g. email local part) for non-privileged roles.
 */
export const piiColumns = {
  kyc_cases: {
    legalName: 'low',
    dateOfBirth: 'high',
    taxId: 'high',
    documentUrl: 'high',
  },
  refunds: {
    customerEmail: 'low',
    cardLast4: 'low',
  },
} as const satisfies Record<string, Record<string, 'high' | 'low'>>;
