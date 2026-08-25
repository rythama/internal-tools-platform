import { beforeEach, describe, expect, it } from 'vitest';
import { useFixedClock, useSystemClock } from '../clock.js';
import { dropAuditGuardsForTests, raw, useInMemoryDatabaseForTests } from '../db/client.js';
import { kycCases } from '../db/schema.js';
import { db } from '../db/client.js';
import { PolicyDeniedError, type Actor } from '../types.js';
import { verifyAuditChain, withAudit } from './index.js';
import { GENESIS_HASH, canonicalJSON } from './hash.js';

const REVIEWER: Actor = { sub: 'u-1', email: 'r@example.com', roles: ['kyc_reviewer'] };
const AUDITOR: Actor = { sub: 'u-2', email: 'a@example.com', roles: ['auditor'] };
const RESOURCE = { type: 'kyc_cases', id: 'KYC-1' };

function seedCase(id = 'KYC-1'): void {
  db()
    .insert(kycCases)
    .values({
      id,
      status: 'pending',
      riskScore: 10,
      submittedAt: '2025-01-01T00:00:00.000Z',
      slaDueAt: '2025-01-03T00:00:00.000Z',
      legalName: 'Test Person',
      dateOfBirth: '1990-01-01',
      taxId: '900000001',
      country: 'US',
      sanctionsHit: false,
    })
    .run();
}

beforeEach(() => {
  useInMemoryDatabaseForTests();
  useFixedClock('2025-03-01T00:00:00.000Z');
  return () => useSystemClock();
});

describe('canonicalJSON', () => {
  it('sorts keys so that field order cannot change a hash', () => {
    expect(canonicalJSON({ b: 1, a: 2 })).toBe(canonicalJSON({ a: 2, b: 1 }));
    expect(canonicalJSON({ a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1}}');
  });

  it('sorts nested keys but preserves array order', () => {
    expect(canonicalJSON([{ b: 1, a: 2 }, 3])).toBe('[{"a":2,"b":1},3]');
    expect(canonicalJSON([1, 2])).not.toBe(canonicalJSON([2, 1]));
  });
});

describe('withAudit', () => {
  it('writes the mutation and its audit row in one transaction', () => {
    withAudit({
      actor: REVIEWER,
      action: 'record.review',
      resource: RESOURCE,
      diff: { status: { before: 'pending', after: 'in_review' } },
      mutate: () => seedCase(),
    });

    expect(raw().prepare('select count(*) as n from kyc_cases').get()).toEqual({ n: 1 });
    const rows = raw().prepare('select * from audit_log').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seq: 1, decision: 'allow', prev_hash: GENESIS_HASH });
  });

  it('rolls the mutation back when the audit write fails', () => {
    // Stand in for any audit-write failure — disk, constraint, or a tampered table.
    raw().exec(`CREATE TRIGGER audit_log_reject BEFORE INSERT ON audit_log
                BEGIN SELECT RAISE(ABORT, 'audit write failed'); END;`);

    expect(() =>
      withAudit({ actor: REVIEWER, action: 'record.review', resource: RESOURCE, mutate: () => seedCase() }),
    ).toThrow(/audit write failed/);

    // The load-bearing assertion: no unaudited mutation survived.
    expect(raw().prepare('select count(*) as n from kyc_cases').get()).toEqual({ n: 0 });
    expect(raw().prepare('select count(*) as n from audit_log').get()).toEqual({ n: 0 });
  });

  it('audits a denial and does not run the mutation', () => {
    let ran = false;
    expect(() =>
      withAudit({
        actor: AUDITOR,
        action: 'record.purge',
        resource: RESOURCE,
        mutate: () => {
          ran = true;
        },
      }),
    ).toThrow(PolicyDeniedError);

    expect(ran).toBe(false);
    const rows = raw().prepare('select decision, action from audit_log').all();
    expect(rows).toEqual([{ decision: 'deny', action: 'record.purge' }]);
  });

  it('hashes PII out of the diff instead of logging it in clear', () => {
    withAudit({
      actor: REVIEWER,
      action: 'record.review',
      resource: RESOURCE,
      diff: { taxId: '900000001', status: 'in_review' },
      mutate: () => undefined,
    });

    const [row] = raw().prepare('select diff from audit_log').all() as Array<{ diff: string }>;
    expect(row?.diff).not.toContain('900000001');
    expect(row?.diff).toContain('sha256:');
    expect(row?.diff).toContain('in_review');
  });
});

describe('verifyAuditChain', () => {
  function appendThree(): void {
    for (const id of ['KYC-1', 'KYC-2', 'KYC-3']) {
      withAudit({
        actor: REVIEWER,
        action: 'record.review',
        resource: { type: 'kyc_cases', id },
        mutate: () => undefined,
      });
    }
  }

  it('accepts an untouched chain, including an empty one', () => {
    expect(verifyAuditChain()).toEqual({ ok: true });
    appendThree();
    expect(verifyAuditChain()).toEqual({ ok: true });
  });

  it('reports the first broken sequence when a row is edited', () => {
    appendThree();
    // Only possible with the append-only triggers removed, which is the threat model:
    // someone with direct database access, not someone using this API.
    dropAuditGuardsForTests();
    raw().exec(`UPDATE audit_log SET resource_id = 'KYC-999' WHERE seq = 2`);

    expect(verifyAuditChain()).toEqual({ ok: false, brokenAtSeq: 2 });
  });

  it('reports the first break, not the last, when several rows are edited', () => {
    appendThree();
    dropAuditGuardsForTests();
    raw().exec(`UPDATE audit_log SET action = 'record.read' WHERE seq IN (2, 3)`);

    expect(verifyAuditChain()).toEqual({ ok: false, brokenAtSeq: 2 });
  });

  it('detects a deleted row through the sequence, not just the hashes', () => {
    appendThree();
    dropAuditGuardsForTests();
    raw().exec('DELETE FROM audit_log WHERE seq = 2');

    expect(verifyAuditChain()).toEqual({ ok: false, brokenAtSeq: 3 });
  });
});

describe('append-only enforcement', () => {
  it('refuses updates and deletes at the database level', () => {
    withAudit({ actor: REVIEWER, action: 'record.review', resource: RESOURCE, mutate: () => undefined });

    expect(() => raw().exec(`UPDATE audit_log SET action = 'x'`)).toThrow(/append-only/);
    expect(() => raw().exec('DELETE FROM audit_log')).toThrow(/append-only/);
  });
});
