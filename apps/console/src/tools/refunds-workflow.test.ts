/**
 * The refunds workflow, end to end, centred on the $500 dual-control threshold.
 *
 * Everything goes through the same functions the routes call, so a regression in the
 * threshold, the policy backstop, or the approval flow fails a test rather than
 * moving money. Each step asserts both halves: what changed in the domain, and what
 * the audit chain now says happened.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  REFUND_SELF_SERVICE_LIMIT_CENTS,
  listApprovals,
  listAuditRows,
  listRows,
  verifyAuditChain,
} from '@itp/core';
// Test seams are deliberately absent from core's public surface, so this suite reaches
// for them the way core's own tests do rather than widening the API for a test.
import { db, useInMemoryDatabaseForTests } from '../../../../packages/core/src/db/client';
import { refunds } from '../../../../packages/core/src/db/schema';
import { useFixedClock } from '../../../../packages/core/src/clock';
import type { Actor } from '../core-adapter/index';
import { performAction, performVote } from '../lib/perform';
import { spec } from '../../../../tools/refunds/spec';
import { REFUNDS_TABLE } from './refunds';

const AGENT: Actor = { sub: 'u-agent', email: 'amy@example.com', roles: ['refund_agent'] };
const APPROVER: Actor = {
  sub: 'u-approver',
  email: 'avi@example.com',
  roles: ['refund_approver'],
};
const OTHER_APPROVER: Actor = {
  sub: 'u-approver-2',
  email: 'ana@example.com',
  roles: ['refund_approver'],
};
const AUDITOR: Actor = { sub: 'u-auditor', email: 'ada@example.com', roles: ['auditor'] };

type RefundSeed = {
  id: string;
  amountCents: number;
  status?: 'requested' | 'pending_approval' | 'approved' | 'rejected' | 'settled';
};

function seedRefund(seed: RefundSeed): void {
  db()
    .insert(refunds)
    .values({
      id: seed.id,
      status: seed.status ?? 'requested',
      amountCents: seed.amountCents,
      currency: 'USD',
      customerEmail: `customer-${seed.id}@example.com`,
      cardLast4: '4242',
      reason: 'duplicate charge',
      requestedAt: '2025-02-01T00:00:00.000Z',
      settlementKey: null,
    })
    .run();
}

/** Audit entries for one refund, oldest first, as the /audit view shows them. */
function trail(refundId: string) {
  return listAuditRows(AUDITOR)
    .filter((entry) => entry.resourceType === REFUNDS_TABLE && entry.resourceId === refundId)
    .reverse();
}

function statusOf(refundId: string): unknown {
  return listRows<Record<string, unknown>>(REFUNDS_TABLE, AUDITOR).find(
    (row) => row['id'] === refundId,
  )?.['status'];
}

beforeEach(() => {
  useInMemoryDatabaseForTests();
  useFixedClock('2025-03-01T00:00:00.000Z');
  seedRefund({ id: 'RFD-AT-LIMIT', amountCents: REFUND_SELF_SERVICE_LIMIT_CENTS });
  seedRefund({ id: 'RFD-OVER', amountCents: REFUND_SELF_SERVICE_LIMIT_CENTS + 1 });
  seedRefund({ id: 'RFD-SMALL', amountCents: 1_500 });
});

describe('at or under the threshold — one pair of hands', () => {
  it('lets an agent approve a refund at exactly the limit, directly', () => {
    const outcome = performAction({ spec, actor: AGENT, id: 'RFD-AT-LIMIT', actionKey: 'approve' });
    expect(outcome).toMatchObject({ status: 'applied' });
    expect(statusOf('RFD-AT-LIMIT')).toBe('approved');
    expect(listApprovals(REFUNDS_TABLE, 'RFD-AT-LIMIT', AUDITOR)).toHaveLength(0);

    const issued = trail('RFD-AT-LIMIT').filter((entry) => entry.action === 'refund.issue');
    expect(issued.map((entry) => entry.decision)).toEqual(['allow']);
  });

  it('lets an agent reject a small refund', () => {
    const outcome = performAction({ spec, actor: AGENT, id: 'RFD-SMALL', actionKey: 'reject' });
    expect(outcome).toMatchObject({ status: 'applied' });
    expect(statusOf('RFD-SMALL')).toBe('rejected');
  });
});

describe('over the threshold — four eyes', () => {
  it('turns approve into an approval request one cent over the limit', () => {
    const outcome = performAction({
      spec,
      actor: APPROVER,
      id: 'RFD-OVER',
      actionKey: 'approve',
    });
    expect(outcome.status).toBe('requested');
    // Crucially: no money moved by asking.
    expect(statusOf('RFD-OVER')).toBe('requested');
    expect(listApprovals(REFUNDS_TABLE, 'RFD-OVER', AUDITOR)).toHaveLength(1);
  });

  it('refuses the policy backstop to an agent, and audits the attempt', () => {
    // The spec would route this to maker–checker, but the policy denies the agent
    // `refund.issue` over the limit first — the second enforcement layer.
    const outcome = performAction({ spec, actor: AGENT, id: 'RFD-OVER', actionKey: 'approve' });
    expect(outcome.status).toBe('denied');
    expect(statusOf('RFD-OVER')).toBe('requested');
    expect(trail('RFD-OVER').some((entry) => entry.decision === 'deny')).toBe(true);
  });

  it('will not let the requester sign their own request', () => {
    const requested = performAction({
      spec,
      actor: APPROVER,
      id: 'RFD-OVER',
      actionKey: 'approve',
    });
    if (requested.status !== 'requested') throw new Error('expected an approval request');

    const selfVote = performVote({
      actor: APPROVER,
      approvalId: requested.approvalId,
      vote: 'approve',
    });
    expect(selfVote.status).toBe('denied');
    expect(statusOf('RFD-OVER')).toBe('requested');
  });

  it('applies the refund once a second approver signs, and chains every step', () => {
    const requested = performAction({
      spec,
      actor: APPROVER,
      id: 'RFD-OVER',
      actionKey: 'approve',
    });
    if (requested.status !== 'requested') throw new Error('expected an approval request');

    const vote = performVote({
      actor: OTHER_APPROVER,
      approvalId: requested.approvalId,
      vote: 'approve',
    });
    expect(vote.status).toBe('ok');
    expect(statusOf('RFD-OVER')).toBe('approved');

    const actions = trail('RFD-OVER').map((entry) => entry.action);
    expect(actions).toContain('approve.request');
    expect(actions).toContain('approve.applied');
    expect(actions).toContain('refund.approve');
    expect(verifyAuditChain().ok).toBe(true);
  });

  it('rejects the refund when the second approver votes reject', () => {
    const requested = performAction({
      spec,
      actor: APPROVER,
      id: 'RFD-OVER',
      actionKey: 'approve',
    });
    if (requested.status !== 'requested') throw new Error('expected an approval request');

    performVote({ actor: OTHER_APPROVER, approvalId: requested.approvalId, vote: 'reject' });
    expect(statusOf('RFD-OVER')).toBe('requested');
    expect(listApprovals(REFUNDS_TABLE, 'RFD-OVER', AUDITOR)[0]?.state).toBe('rejected');
  });
});

describe('state machine and chain integrity', () => {
  it('refuses to approve a refund that is already settled, and audits the refusal', () => {
    seedRefund({ id: 'RFD-SETTLED', amountCents: 900, status: 'settled' });
    const outcome = performAction({ spec, actor: AGENT, id: 'RFD-SETTLED', actionKey: 'approve' });
    expect(outcome.status).toBe('denied');
    expect(statusOf('RFD-SETTLED')).toBe('settled');
    expect(trail('RFD-SETTLED').some((entry) => entry.decision === 'deny')).toBe(true);
  });

  it('keeps the chain intact across the whole workflow', () => {
    performAction({ spec, actor: AGENT, id: 'RFD-AT-LIMIT', actionKey: 'approve' });
    performAction({ spec, actor: AGENT, id: 'RFD-OVER', actionKey: 'approve' });
    performAction({ spec, actor: APPROVER, id: 'RFD-OVER', actionKey: 'approve' });
    expect(verifyAuditChain().ok).toBe(true);
  });
});
