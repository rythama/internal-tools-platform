/**
 * TEMPORARY stand-in for `packages/core/src/policy` (Session 1).
 *
 * This file exists only so the console shell can be built and demonstrated before
 * the core policy module lands. It follows the same shape the architecture requires
 * of the real thing (§3.3): rules as data, pure and total, deny-by-default, every
 * decision carrying a reason. It is the ONLY file in this app that reads roles, and
 * it disappears the moment `can()` is exported from @itp/core — the adapter prefers
 * the real implementation whenever one is present at runtime.
 */
import type { Actor, Decision, Resource, Role } from '@itp/core';

type Rule = {
  roles: readonly Role[];
  /** Exact action names, or '*' for "any action". */
  actions: readonly string[];
  reason: string;
};

const ALLOW_RULES: readonly Rule[] = [
  { roles: ['admin'], actions: ['*'], reason: 'admin holds every action (stub rule)' },
  {
    roles: ['auditor'],
    actions: ['audit.view', 'tool.view', 'record.read'],
    reason: 'auditor may read the chain and any record, and mutate nothing',
  },
  {
    roles: ['kyc_reviewer', 'kyc_approver', 'refund_agent', 'refund_approver', 'flag_admin'],
    actions: ['tool.view', 'record.read'],
    reason: 'operator roles may open the tools they can see and read their records',
  },
  {
    roles: ['kyc_reviewer', 'refund_agent', 'flag_admin'],
    actions: ['record.review'],
    reason: 'maker roles may act on a record, subject to the spec approval rules',
  },
  {
    roles: ['kyc_approver', 'refund_approver'],
    actions: ['record.approve', 'approval.vote'],
    reason: 'checker roles may sign off on someone else’s request',
  },
];

function matches(rule: Rule, roles: readonly Role[], action: string): boolean {
  const roleMatch = rule.roles.some((role) => roles.includes(role));
  const actionMatch = rule.actions.includes('*') || rule.actions.includes(action);
  return roleMatch && actionMatch;
}

/** Pure and total, like the contract requires. Never throws, never does I/O. */
export function stubCan(actor: Actor, action: string, resource: Resource): Decision {
  const roles = actor.roles;

  // Tool visibility is expressed in the spec as `visibleTo`, and passed here as a
  // resource attribute so the intersection with the actor's roles still happens
  // inside the policy module rather than in the console.
  if (action === 'tool.view') {
    const visibleTo = resource.attrs?.['visibleTo'];
    if (Array.isArray(visibleTo) && !visibleTo.some((role) => roles.includes(role as Role))) {
      return { allowed: false, reason: `tool ${resource.id} is not visible to your roles` };
    }
  }

  for (const rule of ALLOW_RULES) {
    if (matches(rule, roles, action)) {
      return { allowed: true, reason: rule.reason };
    }
  }

  return { allowed: false, reason: `no rule grants ${action} on ${resource.type} (deny by default)` };
}
