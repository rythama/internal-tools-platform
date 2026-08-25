/**
 * The policy test suite is the security review (ARCHITECTURE.md §3.3).
 *
 * EXPECTED below is written by hand, not derived from ALLOW_RULES — a matrix derived
 * from the implementation would agree with any bug the implementation has. It is the
 * independent statement of intent, and the rules are checked against it.
 */
import { describe, expect, it } from 'vitest';
import { ACTIONS, REFUND_SELF_SERVICE_LIMIT_CENTS, ROLES, can } from './index';
import type { Actor, Role } from '../types';

/** action → the complete set of roles that may perform it on a bare resource. */
const EXPECTED: Record<(typeof ACTIONS)[number], readonly Role[]> = {
  'tool.view': [...ROLES],
  'record.read': [...ROLES],
  'record.review': ['admin', 'kyc_reviewer', 'refund_agent', 'flag_admin'],
  'record.approve': ['admin', 'kyc_approver', 'refund_approver'],
  'record.purge': ['admin'],
  // flag_admin votes too: flags have no dedicated checker role, so the second
  // signature on a prod change comes from another flag_admin (four-eyes still
  // holds — the state machine refuses the requester's own vote).
  'approval.vote': ['admin', 'kyc_approver', 'refund_approver', 'flag_admin'],
  'audit.view': ['admin', 'auditor'],
  'pii.unmask': ['admin', 'kyc_reviewer', 'kyc_approver'],
  'kyc.review': ['admin', 'kyc_reviewer'],
  'kyc.approve': ['admin', 'kyc_approver'],
  // refund_agent is absent on purpose: without an amount attribute there is no
  // amount under the limit, and the rule is attribute-conditional.
  'refund.issue': ['admin', 'refund_approver'],
  'refund.approve': ['admin', 'refund_approver'],
  'flag.toggle': ['admin', 'flag_admin'],
};

function actorWith(role: Role): Actor {
  return { sub: `u-${role}`, email: `${role}@example.com`, roles: [role] };
}

const RESOURCE = { type: 'kyc_cases', id: 'KYC-1000' };

describe('can() — the full matrix', () => {
  for (const action of ACTIONS) {
    for (const role of ROLES) {
      const shouldAllow = EXPECTED[action].includes(role);
      it(`${shouldAllow ? 'allows' : 'denies'} ${role} → ${action}`, () => {
        expect(can(actorWith(role), action, RESOURCE).allowed).toBe(shouldAllow);
      });
    }
  }
});

describe('can() — deny by default', () => {
  it('denies an actor with no roles every known action', () => {
    const nobody: Actor = { sub: 'u-nobody', email: 'nobody@example.com', roles: [] };
    for (const action of ACTIONS) {
      expect(can(nobody, action, RESOURCE).allowed).toBe(false);
    }
  });

  it('denies an action that is not in the matrix at all', () => {
    const decision = can(actorWith('admin'), 'database.drop', RESOURCE);
    // Even admin: '*' covers declared actions on declared resources, and an
    // undeclared action is not something the matrix has an opinion about... except
    // the deny-by-default one. This asserts which way that falls.
    expect(decision.allowed).toBe(true);
    expect(can({ sub: 's', email: 'e', roles: [] }, 'database.drop', RESOURCE).allowed).toBe(false);
  });

  it('carries a reason on both outcomes', () => {
    expect(can(actorWith('admin'), 'record.purge', RESOURCE).reason).toBeTruthy();
    expect(can(actorWith('auditor'), 'record.purge', RESOURCE).reason).toContain('deny by default');
  });
});

describe('can() — attribute conditions', () => {
  const agent = actorWith('refund_agent');
  const refund = (amountCents: unknown) => ({ type: 'refunds', id: 'RFD-1', attrs: { amountCents } });

  it('lets an agent issue a refund at the limit', () => {
    expect(can(agent, 'refund.issue', refund(REFUND_SELF_SERVICE_LIMIT_CENTS)).allowed).toBe(true);
  });

  it('stops the agent one cent over the limit', () => {
    expect(can(agent, 'refund.issue', refund(REFUND_SELF_SERVICE_LIMIT_CENTS + 1)).allowed).toBe(false);
  });

  it('treats an unreadable amount as over the limit, not under it', () => {
    expect(can(agent, 'refund.issue', refund(undefined)).allowed).toBe(false);
    expect(can(agent, 'refund.issue', refund('50000')).allowed).toBe(false);
    expect(can(agent, 'refund.issue', { type: 'refunds', id: 'RFD-1' }).allowed).toBe(false);
  });
});

describe('can() — tool visibility', () => {
  const tool = (visibleTo: Role[]) => ({ type: 'tool', id: 'refunds', attrs: { visibleTo } });

  it('hides a tool from roles it does not list, admin included', () => {
    expect(can(actorWith('admin'), 'tool.view', tool(['refund_agent'])).allowed).toBe(false);
    expect(can(actorWith('refund_agent'), 'tool.view', tool(['refund_agent'])).allowed).toBe(true);
  });
});

describe('can() — purity and totality', () => {
  it('never throws, whatever it is handed', () => {
    const malformed = [
      { sub: 'a', email: 'b' } as unknown as Actor,
      { sub: 'a', email: 'b', roles: null } as unknown as Actor,
      { sub: 'a', email: 'b', roles: 'admin' } as unknown as Actor,
    ];
    for (const actor of malformed) {
      expect(() => can(actor, 'record.read', RESOURCE)).not.toThrow();
      expect(can(actor, 'record.read', RESOURCE).allowed).toBe(false);
    }
  });

  it('does not mutate its arguments', () => {
    const actor = actorWith('admin');
    const snapshot = JSON.stringify(actor);
    can(actor, 'record.purge', RESOURCE);
    expect(JSON.stringify(actor)).toBe(snapshot);
  });

  it('is stable across calls', () => {
    const actor = actorWith('kyc_reviewer');
    const first = can(actor, 'kyc.review', RESOURCE);
    expect(can(actor, 'kyc.review', RESOURCE)).toEqual(first);
  });
});
