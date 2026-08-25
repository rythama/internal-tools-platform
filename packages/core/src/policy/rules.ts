/**
 * The policy matrix, as data (ARCHITECTURE.md §3.3).
 *
 * Rules are an array, not a chain of `if`s, for one reason: a chain is only
 * enumerable by reading it, and a matrix that cannot be enumerated cannot be
 * exhaustively tested. `policy.test.ts` iterates ACTIONS × ROLES against an expected
 * table, so an action added here without a test is a failing build.
 */
import type { Resource, Role } from '../types';

/**
 * Every action this deployment knows about. Adding an action here without adding it
 * to the expected matrix in `policy.test.ts` fails CI — that is the mechanism the
 * architecture calls "the policy test suite is the security review".
 */
export const ACTIONS = [
  // platform / console shell
  'tool.view',
  'record.read',
  'record.review',
  'record.approve',
  'record.purge',
  'approval.vote',
  'audit.view',
  'pii.unmask',
  // domain actions, consumed by tools/<name>/spec.ts
  'kyc.review',
  'kyc.approve',
  'refund.issue',
  'refund.approve',
  'flag.toggle',
] as const;

export type Action = (typeof ACTIONS)[number];

export const ROLES = [
  'kyc_reviewer',
  'kyc_approver',
  'refund_agent',
  'refund_approver',
  'flag_admin',
  'auditor',
  'admin',
] as const;

export type Rule = {
  /** Stable identifier so a decision can be traced back to the rule that made it. */
  id: string;
  roles: readonly Role[];
  /** Exact action names, or '*' for "any action". */
  actions: readonly string[];
  /**
   * Optional attribute predicate, e.g. an amount threshold. Must be pure and must
   * not throw; `can()` treats a throwing predicate as "did not match" so that the
   * totality guarantee holds even if a future rule misbehaves.
   */
  when?: (resource: Resource) => boolean;
  reason: string;
};

/** Refunds at or below this may be issued by an agent alone. Above it, four eyes. */
export const REFUND_SELF_SERVICE_LIMIT_CENTS = 50_000;

function amountCents(resource: Resource): number | undefined {
  const value = resource.attrs?.['amountCents'];
  return typeof value === 'number' ? value : undefined;
}

export const ALLOW_RULES: readonly Rule[] = [
  {
    id: 'admin-all',
    roles: ['admin'],
    actions: ['*'],
    reason: 'admin holds every action',
  },
  {
    id: 'auditor-read',
    roles: ['auditor'],
    actions: ['audit.view', 'tool.view', 'record.read'],
    reason: 'auditor may read the chain and any record, and mutate nothing',
  },
  {
    id: 'operator-read',
    roles: ['kyc_reviewer', 'kyc_approver', 'refund_agent', 'refund_approver', 'flag_admin'],
    actions: ['tool.view', 'record.read'],
    reason: 'operator roles may open the tools they can see and read their records',
  },
  {
    id: 'maker-review',
    roles: ['kyc_reviewer', 'refund_agent', 'flag_admin'],
    actions: ['record.review'],
    reason: 'maker roles may act on a record, subject to the spec approval rules',
  },
  {
    id: 'checker-signoff',
    roles: ['kyc_approver', 'refund_approver'],
    actions: ['record.approve', 'approval.vote'],
    reason: 'checker roles may sign off on someone else’s request',
  },
  {
    id: 'kyc-maker',
    roles: ['kyc_reviewer'],
    actions: ['kyc.review'],
    reason: 'kyc_reviewer works the review queue',
  },
  {
    id: 'kyc-checker',
    roles: ['kyc_approver'],
    actions: ['kyc.approve'],
    reason: 'kyc_approver signs off on a reviewer’s recommendation',
  },
  {
    /**
     * Attribute-conditional, and deliberately deny-by-default about the attribute:
     * an amount the policy cannot read is not an amount under the limit.
     */
    id: 'refund-maker-under-limit',
    roles: ['refund_agent'],
    actions: ['refund.issue'],
    when: (resource) => {
      const cents = amountCents(resource);
      return cents !== undefined && cents <= REFUND_SELF_SERVICE_LIMIT_CENTS;
    },
    reason: `refund_agent may issue refunds up to ${REFUND_SELF_SERVICE_LIMIT_CENTS} cents unaided`,
  },
  {
    id: 'refund-checker',
    roles: ['refund_approver'],
    actions: ['refund.issue', 'refund.approve'],
    reason: 'refund_approver may issue or sign off on a refund of any size',
  },
  {
    id: 'flag-admin',
    roles: ['flag_admin'],
    actions: ['flag.toggle'],
    reason: 'flag_admin owns feature flag state',
  },
  {
    /**
     * Flags have no dedicated checker role: the second signature on a prod change
     * comes from another flag_admin. Four-eyes still holds — the approvals state
     * machine refuses the requester's own vote regardless of role.
     */
    id: 'flag-checker',
    roles: ['flag_admin'],
    actions: ['approval.vote'],
    reason: 'flag_admin may sign off on another admin’s flag change',
  },
  {
    /**
     * can() only says the role may ever unmask. The second gate is a time-boxed
     * grant on the Actor, checked in pii/ — and the unmask itself is audited (§3.5).
     */
    id: 'pii-unmask',
    roles: ['kyc_reviewer', 'kyc_approver'],
    actions: ['pii.unmask'],
    reason: 'kyc roles may unmask a case they are working, with a grant and an audit record',
  },
];
