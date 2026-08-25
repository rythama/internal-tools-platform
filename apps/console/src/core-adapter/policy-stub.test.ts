/**
 * Policy matrix for the temporary stub. Written in the shape §3.3 asks for so that
 * when core's real `can()` lands, the console's expectations are already enumerated
 * and any divergence shows up as a failing test rather than a missing button.
 */
import { describe, expect, it } from 'vitest';
import type { Actor, Role } from '@itp/core';
import { stubCan } from './policy-stub';

const actorWith = (...roles: Role[]): Actor => ({ sub: 'u', email: 'u@example.com', roles });
const record = { type: 'demo_records', id: 'REC-1' };

const MATRIX: Array<[Role, string, boolean]> = [
  ['kyc_reviewer', 'record.read', true],
  ['kyc_reviewer', 'record.review', true],
  ['kyc_reviewer', 'record.approve', false],
  ['kyc_reviewer', 'approval.vote', false],
  ['kyc_reviewer', 'audit.view', false],
  ['kyc_approver', 'record.read', true],
  ['kyc_approver', 'record.review', false],
  ['kyc_approver', 'approval.vote', true],
  ['auditor', 'record.read', true],
  ['auditor', 'record.review', false],
  ['auditor', 'audit.view', true],
  ['refund_agent', 'record.review', true],
  ['refund_approver', 'approval.vote', true],
  ['flag_admin', 'record.review', true],
  ['admin', 'audit.view', true],
  ['admin', 'record.purge', true],
];

describe('stub policy matrix', () => {
  for (const [role, action, expected] of MATRIX) {
    it(`${role} ${expected ? 'may' : 'may not'} ${action}`, () => {
      expect(stubCan(actorWith(role), action, record).allowed).toBe(expected);
    });
  }

  it('denies an unknown action for every role, with a reason', () => {
    for (const role of ['kyc_reviewer', 'auditor', 'refund_agent'] as const) {
      const decision = stubCan(actorWith(role), 'record.exfiltrate', record);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('deny by default');
    }
  });

  it('denies an actor with no roles at all', () => {
    expect(stubCan(actorWith(), 'record.read', record).allowed).toBe(false);
  });

  it('evaluates tool visibility from the spec attribute, not from the console', () => {
    const tool = { type: 'tool', id: 'demo', attrs: { visibleTo: ['kyc_approver'] } };
    expect(stubCan(actorWith('kyc_approver'), 'tool.view', tool).allowed).toBe(true);
    expect(stubCan(actorWith('kyc_reviewer'), 'tool.view', tool).allowed).toBe(false);
  });

  it('is total: never throws, whatever it is handed', () => {
    expect(() => stubCan(actorWith('admin'), '', { type: '', id: '' })).not.toThrow();
  });
});
