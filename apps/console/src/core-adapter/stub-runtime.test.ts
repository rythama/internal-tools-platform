/**
 * These assert the *shape* the console depends on — audited mutations, a verifiable
 * chain, four-eyes — against the local stub. When Session 1 lands, the same
 * expectations should hold against the real core, which is the point of writing them
 * here rather than trusting the stub.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@itp/core';
import {
  PolicyDeniedError,
  resetStubStore,
  seedStubTable,
  stubCastVote,
  stubListApprovals,
  stubListAuditRows,
  stubMaskRow,
  stubRequestApproval,
  stubVerifyAuditChain,
  stubWithAudit,
  tamperWithAuditRowForTests,
} from './stub-runtime';

const maker: Actor = { sub: 'u-maker', email: 'maker@example.com', roles: ['kyc_reviewer'] };
const checker: Actor = { sub: 'u-checker', email: 'checker@example.com', roles: ['kyc_approver'] };
const resource = { type: 'demo_records', id: 'REC-1' };

beforeEach(() => {
  resetStubStore();
  seedStubTable('demo_records', [{ id: 'REC-1', contactEmail: 'a@example.com', reference: 'REF-1' }], {
    contactEmail: 'low',
    reference: 'high',
  });
});

describe('audit chain', () => {
  it('records an allowed mutation and verifies from genesis', () => {
    stubWithAudit({ actor: maker, action: 'record.review', resource, mutate: () => 'ok' });
    expect(stubVerifyAuditChain()).toEqual({ ok: true });
    expect(stubListAuditRows()).toHaveLength(1);
  });

  it('records a denial and still refuses the mutation', () => {
    let mutated = false;
    expect(() =>
      stubWithAudit({
        actor: maker,
        action: 'record.purge',
        resource,
        mutate: () => {
          mutated = true;
        },
      }),
    ).toThrow(PolicyDeniedError);

    expect(mutated).toBe(false);
    const rows = stubListAuditRows();
    expect(rows.at(-1)?.decision).toBe('deny');
    expect(stubVerifyAuditChain()).toEqual({ ok: true });
  });

  it('reports the sequence of the first tampered row', () => {
    stubWithAudit({ actor: maker, action: 'record.review', resource, mutate: () => undefined });
    stubWithAudit({ actor: maker, action: 'record.review', resource, mutate: () => undefined });
    tamperWithAuditRowForTests(1, { action: 'record.read' });
    expect(stubVerifyAuditChain()).toEqual({ ok: false, brokenAtSeq: 1 });
  });
});

describe('pii masking', () => {
  it('redacts high-classified fields and partially masks low ones', () => {
    const masked = stubMaskRow(
      'demo_records',
      { id: 'REC-1', contactEmail: 'alice@example.com', reference: 'REF-12345' },
      maker,
    );
    expect(JSON.stringify(masked)).not.toContain('REF-12345');
    expect(masked.reference).toBe('[redacted]');
    expect(masked.contactEmail).toBe('a***@example.com');
  });

  it('refuses to unmask without a grant, and audits the unmask when granted', () => {
    expect(() => stubMaskRow('demo_records', { id: 'REC-1' }, maker, { unmask: true })).toThrow(
      PolicyDeniedError,
    );

    const granted: Actor = {
      ...maker,
      unmaskGrants: [{ resourceType: 'demo_records', expiresAt: '2999-01-01T00:00:00.000Z' }],
    };
    stubMaskRow('demo_records', { id: 'REC-1', reference: 'REF-12345' }, granted, { unmask: true });
    expect(stubListAuditRows().at(-1)?.action).toBe('pii.unmask');
  });
});

describe('maker-checker', () => {
  it('records the request, blocks self-approval, and applies on the checker vote', () => {
    const { approvalId } = stubRequestApproval({
      actor: maker,
      action: 'close',
      resource,
      payload: { action: 'close' },
      requiredApprovals: 1,
      disallowSelfApproval: true,
    });

    expect(() => stubCastVote({ actor: maker, approvalId, vote: 'approve' })).toThrow(PolicyDeniedError);
    expect(stubListAuditRows().at(-1)?.decision).toBe('deny');

    const result = stubCastVote({ actor: checker, approvalId, vote: 'approve', note: 'checked' });
    expect(result.state).toBe('applied');

    const [approval] = stubListApprovals('demo_records', 'REC-1');
    expect(approval?.votes).toHaveLength(1);
    expect(approval?.votes[0]?.note).toBe('checked');
    expect(stubVerifyAuditChain()).toEqual({ ok: true });
  });

  it('rejects outright on a reject vote', () => {
    const { approvalId } = stubRequestApproval({
      actor: maker,
      action: 'close',
      resource,
      payload: {},
      requiredApprovals: 2,
      disallowSelfApproval: true,
    });
    expect(stubCastVote({ actor: checker, approvalId, vote: 'reject' }).state).toBe('rejected');
  });
});
