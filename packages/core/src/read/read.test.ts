import { beforeEach, describe, expect, it } from 'vitest';
import { useFixedClock, useSystemClock } from '../clock.js';
import { db, useInMemoryDatabaseForTests } from '../db/client.js';
import { kycCases, refunds } from '../db/schema.js';
import { withAudit } from '../audit/index.js';
import { requestApproval } from '../approvals/index.js';
import { REDACTED } from '../pii/index.js';
import type { Actor } from '../types.js';
import { getRow, listApprovals, listAuditRows, listRows } from './index.js';

const REVIEWER: Actor = { sub: 'u-1', email: 'r@example.com', roles: ['kyc_reviewer'] };
const AUDITOR: Actor = { sub: 'u-2', email: 'a@example.com', roles: ['auditor'] };
const NOBODY: Actor = { sub: 'u-3', email: 'n@example.com', roles: [] };

beforeEach(() => {
  useInMemoryDatabaseForTests();
  useFixedClock('2025-03-01T00:00:00.000Z');
  db()
    .insert(kycCases)
    .values({
      id: 'KYC-1',
      status: 'pending',
      riskScore: 10,
      submittedAt: '2025-01-01T00:00:00.000Z',
      slaDueAt: '2025-01-03T00:00:00.000Z',
      legalName: 'Ada Lovelace',
      dateOfBirth: '1815-12-10',
      taxId: '900000001',
      country: 'GB',
      documentUrl: 'https://files.example.invalid/kyc/1.pdf',
      sanctionsHit: false,
    })
    .run();
  db()
    .insert(refunds)
    .values({
      id: 'RFD-1',
      status: 'requested',
      amountCents: 1200,
      currency: 'USD',
      customerEmail: 'ada@example.com',
      cardLast4: '4242',
      reason: 'duplicate charge',
      requestedAt: '2025-01-01T00:00:00.000Z',
    })
    .run();
  return () => useSystemClock();
});

describe('listRows', () => {
  it('masks every row it returns', () => {
    const [row] = listRows<Record<string, unknown>>('kyc_cases', REVIEWER);
    expect(row).toMatchObject({
      id: 'KYC-1',
      taxId: REDACTED,
      dateOfBirth: REDACTED,
      documentUrl: REDACTED,
      legalName: '********lace',
    });
  });

  it('omits rows the actor may not read rather than relying on the UI to hide them', () => {
    expect(listRows('kyc_cases', NOBODY)).toEqual([]);
    expect(listRows('refunds', NOBODY)).toEqual([]);
    expect(listRows('kyc_cases', REVIEWER)).toHaveLength(1);
  });

  it('reads an unknown table as empty rather than throwing', () => {
    expect(listRows('not_a_table', REVIEWER)).toEqual([]);
  });

  it('never emits high PII in the serialized payload', () => {
    const payload = JSON.stringify({
      kyc: listRows('kyc_cases', REVIEWER),
      refunds: listRows('refunds', REVIEWER),
    });
    expect(payload).not.toContain('900000001');
    expect(payload).not.toContain('1815-12-10');
    expect(payload).not.toContain('ada@example.com');
    expect(payload).toContain('a***@example.com');
  });
});

describe('getRow', () => {
  it('masks the row it returns', () => {
    expect(getRow<Record<string, unknown>>('refunds', 'RFD-1', REVIEWER)).toMatchObject({
      customerEmail: 'a***@example.com',
      cardLast4: '**** 4242',
    });
  });

  it('is undefined for an unauthorized actor and for a missing id alike', () => {
    expect(getRow('kyc_cases', 'KYC-1', NOBODY)).toBeUndefined();
    expect(getRow('kyc_cases', 'KYC-404', REVIEWER)).toBeUndefined();
  });
});

describe('listAuditRows', () => {
  it('returns the chain newest first to an auditor', () => {
    for (const id of ['KYC-1', 'KYC-2']) {
      withAudit({
        actor: REVIEWER,
        action: 'record.review',
        resource: { type: 'kyc_cases', id },
        mutate: () => undefined,
      });
    }
    const rows = listAuditRows(AUDITOR);
    expect(rows.map((row) => row.seq)).toEqual([2, 1]);
    expect(rows[0]?.hash).toBeTruthy();
  });

  it('is empty for an actor without audit.view', () => {
    withAudit({ actor: REVIEWER, action: 'record.review', resource: { type: 'kyc_cases', id: 'KYC-1' }, mutate: () => undefined });
    expect(listAuditRows(REVIEWER)).toEqual([]);
  });
});

describe('listApprovals', () => {
  it('returns approvals with their votes for an authorized reader', () => {
    requestApproval({
      actor: REVIEWER,
      action: 'approve',
      permission: 'kyc.review',
      resource: { type: 'kyc_cases', id: 'KYC-1' },
      payload: {},
      requiredApprovals: 1,
      disallowSelfApproval: true,
    });

    const [approval] = listApprovals('kyc_cases', 'KYC-1', REVIEWER);
    expect(approval).toMatchObject({ state: 'pending', requestedBy: 'u-1', votes: [] });
    expect(listApprovals('kyc_cases', 'KYC-1', NOBODY)).toEqual([]);
  });
});
