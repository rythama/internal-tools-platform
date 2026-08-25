import { beforeEach, describe, expect, it } from 'vitest';
import { useFixedClock, useSystemClock } from '../clock';
import { raw, useInMemoryDatabaseForTests } from '../db/client';
import { verifyAuditChain } from '../audit/index';
import { PolicyDeniedError, type Actor } from '../types';
import { SELF_APPROVAL_REASON, castVote, findApproval, requestApproval } from './index';

const MAKER: Actor = { sub: 'u-maker', email: 'maker@example.com', roles: ['kyc_reviewer'] };
const CHECKER_A: Actor = { sub: 'u-a', email: 'a@example.com', roles: ['kyc_approver'] };
const CHECKER_B: Actor = { sub: 'u-b', email: 'b@example.com', roles: ['kyc_approver'] };
const OUTSIDER: Actor = { sub: 'u-out', email: 'out@example.com', roles: ['refund_agent'] };
const RESOURCE = { type: 'kyc_cases', id: 'KYC-1' };

function request(requiredApprovals = 1, disallowSelfApproval = true) {
  return requestApproval({
    actor: MAKER,
    action: 'approve',
    permission: 'kyc.review',
    resource: RESOURCE,
    payload: { decision: 'approve' },
    requiredApprovals,
    disallowSelfApproval,
  });
}

function auditActions(): string[] {
  return (raw().prepare('select action from audit_log order by seq').all() as Array<{ action: string }>).map(
    (row) => row.action,
  );
}

beforeEach(() => {
  useInMemoryDatabaseForTests();
  useFixedClock('2025-03-01T00:00:00.000Z');
  return () => useSystemClock();
});

describe('requestApproval', () => {
  it('opens a pending approval and records the request', () => {
    const { approvalId, state } = request();
    expect(state).toBe('pending');
    expect(findApproval(approvalId)?.state).toBe('pending');
    expect(auditActions()).toEqual(['approve.request']);
  });

  it('refuses a requester who may not perform the underlying action, and audits it', () => {
    expect(() =>
      requestApproval({
        actor: OUTSIDER,
        action: 'approve',
        permission: 'kyc.review',
        resource: RESOURCE,
        payload: {},
        requiredApprovals: 1,
        disallowSelfApproval: true,
      }),
    ).toThrow(PolicyDeniedError);
    expect(raw().prepare(`select count(*) as n from audit_log where decision='deny'`).get()).toEqual({
      n: 1,
    });
  });
});

describe('self-approval', () => {
  it('rejects the requester’s own vote when disallowSelfApproval is set', () => {
    const { approvalId } = request();
    // The maker here also holds no approval.vote permission; give them one that does
    // to prove the rejection is about identity, not about role.
    const makerAsChecker: Actor = { ...MAKER, roles: ['kyc_reviewer', 'kyc_approver'] };

    expect(() => castVote({ actor: makerAsChecker, approvalId, vote: 'approve' })).toThrow(
      SELF_APPROVAL_REASON,
    );
    expect(findApproval(approvalId)?.state).toBe('pending');
    expect(auditActions()).toEqual(['approve.request', 'approval.vote']);
  });

  it('allows it when the spec opts out of four-eyes', () => {
    const { approvalId } = request(1, false);
    const makerAsChecker: Actor = { ...MAKER, roles: ['kyc_reviewer', 'kyc_approver'] };
    expect(castVote({ actor: makerAsChecker, approvalId, vote: 'approve' })).toEqual({
      state: 'applied',
    });
  });

  it('rejects a voter with no approval.vote permission', () => {
    const { approvalId } = request();
    expect(() => castVote({ actor: OUTSIDER, approvalId, vote: 'approve' })).toThrow(PolicyDeniedError);
    expect(findApproval(approvalId)?.state).toBe('pending');
  });
});

describe('N-of-M', () => {
  it('stays pending until the Nth approval arrives', () => {
    const { approvalId } = request(2);
    expect(castVote({ actor: CHECKER_A, approvalId, vote: 'approve' })).toEqual({ state: 'pending' });
    expect(castVote({ actor: CHECKER_B, approvalId, vote: 'approve' })).toEqual({ state: 'applied' });
  });

  it('does not let one checker satisfy a 2-of-M by voting twice', () => {
    const { approvalId } = request(2);
    castVote({ actor: CHECKER_A, approvalId, vote: 'approve' });
    expect(castVote({ actor: CHECKER_A, approvalId, vote: 'approve' })).toEqual({ state: 'pending' });
    expect(findApproval(approvalId)?.state).toBe('pending');
  });

  it('rejects outright on a single reject vote', () => {
    const { approvalId } = request(2);
    expect(castVote({ actor: CHECKER_A, approvalId, vote: 'reject', note: 'docs missing' })).toEqual({
      state: 'rejected',
    });
    expect(castVote({ actor: CHECKER_B, approvalId, vote: 'approve' })).toEqual({ state: 'rejected' });
  });
});

describe('idempotence', () => {
  it('applies once; a second vote on a satisfied approval is a no-op', () => {
    const { approvalId } = request(1);
    expect(castVote({ actor: CHECKER_A, approvalId, vote: 'approve' })).toEqual({ state: 'applied' });
    const after = auditActions();

    expect(castVote({ actor: CHECKER_B, approvalId, vote: 'approve' })).toEqual({ state: 'applied' });
    expect(auditActions()).toEqual(after);
    expect(auditActions().filter((action) => action === 'approve.applied')).toHaveLength(1);
    expect(raw().prepare('select count(*) as n from approval_votes').get()).toEqual({ n: 1 });
  });
});

describe('the chain', () => {
  it('stays verifiable across a full maker-checker round trip', () => {
    const { approvalId } = request(2);
    try {
      castVote({ actor: OUTSIDER, approvalId, vote: 'approve' });
    } catch {
      // denial is part of the record
    }
    castVote({ actor: CHECKER_A, approvalId, vote: 'approve' });
    castVote({ actor: CHECKER_B, approvalId, vote: 'approve' });

    expect(verifyAuditChain()).toEqual({ ok: true });
    expect(auditActions()).toEqual([
      'approve.request',
      'approval.vote',
      'approval.vote',
      'approval.vote',
      'approve.applied',
    ]);
  });
});
