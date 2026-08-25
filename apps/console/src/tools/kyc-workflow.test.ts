/**
 * The KYC review workflow, end to end, in the order an operator lives it.
 *
 * Everything here goes through the same functions the routes and pages call, so a
 * regression in policy, masking, dual control or audit fails a test rather than being
 * found by an auditor. Each step asserts both halves: what changed in the domain, and
 * what the audit chain now says happened.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { sortRows } from '@itp/ui';
import { listApprovals, listAuditRows, listRows, verifyAuditChain } from '@itp/core';
// Test seams are deliberately absent from core's public surface, so this suite reaches
// for them the way core's own tests do rather than widening the API for a test.
import { db, useInMemoryDatabaseForTests } from '../../../../packages/core/src/db/client';
import { kycCases } from '../../../../packages/core/src/db/schema';
import { useFixedClock } from '../../../../packages/core/src/clock';
import type { Actor } from '../core-adapter/index';
import { performAction, performUnmask, performVote } from '../lib/perform';
import { spec } from '../../../../tools/kyc-review/spec';
import { KYC_TABLE, MIN_UNMASK_REASON_LENGTH, UNMASKABLE_FIELDS } from './kyc-review';

const REVIEWER: Actor = {
  sub: 'u-reviewer',
  email: 'rina@example.com',
  roles: ['kyc_reviewer'],
};
const OTHER_REVIEWER: Actor = {
  sub: 'u-reviewer-2',
  email: 'raj@example.com',
  roles: ['kyc_reviewer'],
};
const APPROVER: Actor = {
  sub: 'u-approver',
  email: 'ash@example.com',
  roles: ['kyc_approver'],
};
const AUDITOR: Actor = { sub: 'u-auditor', email: 'ada@example.com', roles: ['auditor'] };

type CaseSeed = {
  id: string;
  riskScore: number;
  slaDueAt: string;
  sanctionsHit?: boolean;
  status?: 'pending' | 'in_review' | 'escalated' | 'approved' | 'rejected';
};

function seedCase(seed: CaseSeed): void {
  db()
    .insert(kycCases)
    .values({
      id: seed.id,
      status: seed.status ?? 'pending',
      riskScore: seed.riskScore,
      submittedAt: '2025-02-01T00:00:00.000Z',
      slaDueAt: seed.slaDueAt,
      legalName: `Subject ${seed.id}`,
      dateOfBirth: '1970-04-05',
      taxId: `9000000${seed.id.slice(-1)}`,
      country: 'GB',
      documentUrl: `https://files.example.invalid/${seed.id}.pdf`,
      sanctionsHit: seed.sanctionsHit ?? false,
    })
    .run();
}

/** Audit entries for one case, oldest first, as the /audit view shows them. */
function trail(caseId: string) {
  return listAuditRows(AUDITOR)
    .filter((entry) => entry.resourceType === KYC_TABLE && entry.resourceId === caseId)
    .reverse();
}

function statusOf(caseId: string): unknown {
  return listRows<Record<string, unknown>>(KYC_TABLE, AUDITOR).find(
    (row) => row['id'] === caseId,
  )?.['status'];
}

beforeEach(() => {
  useInMemoryDatabaseForTests();
  useFixedClock('2025-03-01T00:00:00.000Z');
  seedCase({ id: 'KYC-LOW', riskScore: 10, slaDueAt: '2025-03-05T00:00:00.000Z' });
  seedCase({ id: 'KYC-RISKY', riskScore: 91, slaDueAt: '2025-03-04T00:00:00.000Z' });
  seedCase({
    id: 'KYC-SANCTIONED',
    riskScore: 12,
    slaDueAt: '2025-03-02T00:00:00.000Z',
    sanctionsHit: true,
  });
});

describe('step 1 — the queue', () => {
  it('puts the case closest to breaching its SLA first', () => {
    const rows = sortRows(listRows(KYC_TABLE, REVIEWER), spec.queue.defaultSort);
    expect(rows.map((row) => row['id'])).toEqual(['KYC-SANCTIONED', 'KYC-RISKY', 'KYC-LOW']);
  });

  it('shows the queue to a reviewer and hides it from nobody in particular', () => {
    expect(listRows(KYC_TABLE, REVIEWER)).toHaveLength(3);
    expect(listRows(KYC_TABLE, { sub: 'x', email: 'x@example.com', roles: [] })).toHaveLength(0);
  });
});

describe('step 2 — PII is masked by default', () => {
  it('masks taxId and dateOfBirth for the reviewer who owns the case', () => {
    const row = listRows<Record<string, unknown>>(KYC_TABLE, REVIEWER).find(
      (candidate) => candidate['id'] === 'KYC-LOW',
    );
    expect(row?.['taxId']).not.toContain('9000000');
    expect(String(row?.['dateOfBirth'])).not.toBe('1970-04-05');
    // legalName is classified low, so it is partially masked rather than redacted:
    // enough to recognise a case in the queue, not enough to be a copy of the record.
    expect(String(row?.['legalName'])).toContain('*');
    expect(String(row?.['legalName'])).toContain('-LOW');
  });
});

describe('step 3 — unmask with a reason', () => {
  const args = {
    actor: REVIEWER,
    table: KYC_TABLE,
    id: 'KYC-LOW',
    fields: UNMASKABLE_FIELDS,
    minReasonLength: MIN_UNMASK_REASON_LENGTH,
  };

  it('reveals the values and records the reason on the chain', () => {
    const outcome = performUnmask({ ...args, reason: 'Verifying tax id against the document' });
    expect(outcome).toMatchObject({ status: 'revealed' });
    if (outcome.status !== 'revealed') return;
    expect(outcome.fields['taxId']).toBe('9000000W');
    expect(outcome.fields['dateOfBirth']).toBe('1970-04-05');

    const unmasks = trail('KYC-LOW').filter((entry) => entry.action === 'pii.unmask');
    expect(unmasks).toHaveLength(1);
    expect(unmasks[0]?.decision).toBe('allow');
    expect(unmasks[0]?.actorEmail).toBe(REVIEWER.email);
    expect(JSON.stringify(unmasks[0]?.diff)).toContain('Verifying tax id');
  });

  it('refuses a reason too short to mean anything, and audits the refusal', () => {
    const outcome = performUnmask({ ...args, reason: 'because' });
    expect(outcome.status).toBe('denied');
    const denials = trail('KYC-LOW').filter((entry) => entry.decision === 'deny');
    expect(denials).toHaveLength(1);
    expect(denials[0]?.action).toBe('pii.unmask');
  });

  it('refuses a role without pii.unmask, and audits that too', () => {
    // An auditor can read the case and the chain, and still cannot see the tax id.
    const outcome = performUnmask({
      ...args,
      actor: AUDITOR,
      reason: 'Curious about this applicant',
    });
    expect(outcome.status).toBe('denied');
    expect(trail('KYC-LOW').some((entry) => entry.decision === 'deny')).toBe(true);
  });

  it('never puts the clear value in the audit diff', () => {
    performUnmask({ ...args, reason: 'Verifying tax id against the document' });
    expect(JSON.stringify(trail('KYC-LOW'))).not.toContain('9000000W');
  });
});

describe('step 4 — review actions on a low-risk case', () => {
  it('walks pending → in_review → approved with one audit row each', () => {
    expect(performAction({ spec, actor: REVIEWER, id: 'KYC-LOW', actionKey: 'start_review' }))
      .toMatchObject({ status: 'applied' });
    expect(statusOf('KYC-LOW')).toBe('in_review');

    expect(performAction({ spec, actor: REVIEWER, id: 'KYC-LOW', actionKey: 'approve' }))
      .toMatchObject({ status: 'applied' });
    expect(statusOf('KYC-LOW')).toBe('approved');

    const actions = trail('KYC-LOW').filter((entry) => entry.action.startsWith('kyc.'));
    expect(actions.map((entry) => entry.decision)).toEqual(['allow', 'allow']);
    expect(JSON.stringify(actions)).toContain('in_review');
  });

  it('escalates and rejects from the states the tool allows', () => {
    expect(performAction({ spec, actor: REVIEWER, id: 'KYC-RISKY', actionKey: 'escalate' }))
      .toMatchObject({ status: 'applied' });
    expect(statusOf('KYC-RISKY')).toBe('escalated');

    expect(performAction({ spec, actor: REVIEWER, id: 'KYC-LOW', actionKey: 'reject' }))
      .toMatchObject({ status: 'applied' });
    expect(statusOf('KYC-LOW')).toBe('rejected');
  });

  it('refuses a transition the case state forbids, and audits the refusal', () => {
    performAction({ spec, actor: REVIEWER, id: 'KYC-LOW', actionKey: 'reject' });
    const outcome = performAction({
      spec,
      actor: REVIEWER,
      id: 'KYC-LOW',
      actionKey: 'start_review',
    });
    expect(outcome.status).toBe('denied');
    expect(statusOf('KYC-LOW')).toBe('rejected');
    expect(trail('KYC-LOW').some((entry) => entry.decision === 'deny')).toBe(true);
  });

  it('refuses an action the actor has no permission for, and audits it', () => {
    const outcome = performAction({
      spec,
      actor: AUDITOR,
      id: 'KYC-LOW',
      actionKey: 'start_review',
    });
    expect(outcome.status).toBe('denied');
    const denial = trail('KYC-LOW').find((entry) => entry.decision === 'deny');
    expect(denial?.actorEmail).toBe(AUDITOR.email);
  });
});

describe('step 5 — high-risk and sanctions cases need a second signature', () => {
  it('turns approve into an approval request when riskScore clears the threshold', () => {
    performAction({ spec, actor: REVIEWER, id: 'KYC-RISKY', actionKey: 'start_review' });
    const outcome = performAction({ spec, actor: REVIEWER, id: 'KYC-RISKY', actionKey: 'approve' });
    expect(outcome.status).toBe('requested');
    // Crucially: nothing was approved by asking.
    expect(statusOf('KYC-RISKY')).toBe('in_review');
    expect(listApprovals(KYC_TABLE, 'KYC-RISKY', REVIEWER)).toHaveLength(1);
  });

  it('turns approve into an approval request on a sanctions hit whatever the score', () => {
    performAction({ spec, actor: REVIEWER, id: 'KYC-SANCTIONED', actionKey: 'start_review' });
    const outcome = performAction({
      spec,
      actor: REVIEWER,
      id: 'KYC-SANCTIONED',
      actionKey: 'approve',
    });
    expect(outcome.status).toBe('requested');
    expect(statusOf('KYC-SANCTIONED')).toBe('in_review');
  });

  it('lets a low-risk case through without an approval', () => {
    performAction({ spec, actor: REVIEWER, id: 'KYC-LOW', actionKey: 'start_review' });
    expect(performAction({ spec, actor: REVIEWER, id: 'KYC-LOW', actionKey: 'approve' }).status)
      .toBe('applied');
    expect(listApprovals(KYC_TABLE, 'KYC-LOW', REVIEWER)).toHaveLength(0);
  });

  it('will not let the requester sign their own request', () => {
    performAction({ spec, actor: REVIEWER, id: 'KYC-RISKY', actionKey: 'start_review' });
    const requested = performAction({
      spec,
      actor: REVIEWER,
      id: 'KYC-RISKY',
      actionKey: 'approve',
    });
    if (requested.status !== 'requested') throw new Error('expected an approval request');

    const selfVote = performVote({
      actor: REVIEWER,
      approvalId: requested.approvalId,
      vote: 'approve',
    });
    expect(selfVote.status).toBe('denied');
    expect(statusOf('KYC-RISKY')).toBe('in_review');
    expect(trail('KYC-RISKY').some((entry) => entry.decision === 'deny')).toBe(true);
  });

  it('will not let another reviewer stand in for an approver', () => {
    performAction({ spec, actor: REVIEWER, id: 'KYC-RISKY', actionKey: 'start_review' });
    const requested = performAction({
      spec,
      actor: REVIEWER,
      id: 'KYC-RISKY',
      actionKey: 'approve',
    });
    if (requested.status !== 'requested') throw new Error('expected an approval request');

    expect(
      performVote({ actor: OTHER_REVIEWER, approvalId: requested.approvalId, vote: 'approve' })
        .status,
    ).toBe('denied');
    expect(statusOf('KYC-RISKY')).toBe('in_review');
  });
});

describe('step 6 — the approver signs off and the case transitions', () => {
  it('applies the approved action under the approver, and records both', () => {
    performAction({ spec, actor: REVIEWER, id: 'KYC-SANCTIONED', actionKey: 'start_review' });
    const requested = performAction({
      spec,
      actor: REVIEWER,
      id: 'KYC-SANCTIONED',
      actionKey: 'approve',
    });
    if (requested.status !== 'requested') throw new Error('expected an approval request');

    const vote = performVote({
      actor: APPROVER,
      approvalId: requested.approvalId,
      vote: 'approve',
      note: 'Sanctions match reviewed and cleared',
    });
    expect(vote.status).toBe('ok');
    expect(statusOf('KYC-SANCTIONED')).toBe('approved');

    const applied = trail('KYC-SANCTIONED').filter(
      (entry) => entry.action === 'kyc.approve' && entry.decision === 'allow',
    );
    expect(applied.at(-1)?.actorEmail).toBe(APPROVER.email);
    expect(listApprovals(KYC_TABLE, 'KYC-SANCTIONED', APPROVER)[0]?.state).toBe('applied');
  });

  it('leaves the case alone when the approver rejects', () => {
    performAction({ spec, actor: REVIEWER, id: 'KYC-RISKY', actionKey: 'start_review' });
    const requested = performAction({
      spec,
      actor: REVIEWER,
      id: 'KYC-RISKY',
      actionKey: 'approve',
    });
    if (requested.status !== 'requested') throw new Error('expected an approval request');

    expect(
      performVote({ actor: APPROVER, approvalId: requested.approvalId, vote: 'reject' }).status,
    ).toBe('ok');
    expect(statusOf('KYC-RISKY')).toBe('in_review');
  });
});

describe('step 7 — the audit chain', () => {
  it('holds every step, allow and deny, and still verifies', () => {
    performUnmask({
      actor: REVIEWER,
      table: KYC_TABLE,
      id: 'KYC-SANCTIONED',
      fields: UNMASKABLE_FIELDS,
      reason: 'Confirming identity against the sanctions list entry',
      minReasonLength: MIN_UNMASK_REASON_LENGTH,
    });
    performAction({ spec, actor: AUDITOR, id: 'KYC-SANCTIONED', actionKey: 'start_review' });
    performAction({ spec, actor: REVIEWER, id: 'KYC-SANCTIONED', actionKey: 'start_review' });
    const requested = performAction({
      spec,
      actor: REVIEWER,
      id: 'KYC-SANCTIONED',
      actionKey: 'approve',
    });
    if (requested.status !== 'requested') throw new Error('expected an approval request');
    performVote({ actor: REVIEWER, approvalId: requested.approvalId, vote: 'approve' });
    performVote({ actor: APPROVER, approvalId: requested.approvalId, vote: 'approve' });

    const entries = trail('KYC-SANCTIONED');
    expect(entries.filter((entry) => entry.decision === 'deny').length).toBeGreaterThanOrEqual(2);
    expect(entries.some((entry) => entry.action === 'pii.unmask')).toBe(true);
    expect(entries.some((entry) => entry.actorEmail === APPROVER.email)).toBe(true);
    expect(verifyAuditChain().ok).toBe(true);
  });
});
