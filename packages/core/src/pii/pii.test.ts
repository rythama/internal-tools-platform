import { beforeEach, describe, expect, it } from 'vitest';
import { useFixedClock, useSystemClock } from '../clock.js';
import { raw, useInMemoryDatabaseForTests } from '../db/client.js';
import { PolicyDeniedError, type Actor } from '../types.js';
import { REDACTED, maskRow, maskValues, partialMask } from './index.js';

const KYC_ROW = {
  id: 'KYC-1',
  status: 'pending',
  legalName: 'Ada Lovelace',
  dateOfBirth: '1815-12-10',
  taxId: '900000001',
  documentUrl: 'https://files.example.invalid/kyc/1.pdf',
};

const REFUND_ROW = {
  id: 'RFD-1',
  customerEmail: 'ada@example.com',
  cardLast4: '4242',
  amountCents: 1200,
};

const NO_GRANT: Actor = { sub: 'u-1', email: 'r@example.com', roles: ['kyc_reviewer'] };
const GRANTED: Actor = {
  ...NO_GRANT,
  unmaskGrants: [{ resourceType: 'kyc_cases', expiresAt: '2025-03-01T01:00:00.000Z' }],
};
const EXPIRED: Actor = {
  ...NO_GRANT,
  unmaskGrants: [{ resourceType: 'kyc_cases', expiresAt: '2024-01-01T00:00:00.000Z' }],
};
const AGENT: Actor = { sub: 'u-2', email: 'a@example.com', roles: ['refund_agent'] };

beforeEach(() => {
  useInMemoryDatabaseForTests();
  useFixedClock('2025-03-01T00:00:00.000Z');
  return () => useSystemClock();
});

describe('partialMask', () => {
  it('keeps an email recognisable and nothing more', () => {
    expect(partialMask('ada@example.com')).toBe('a***@example.com');
  });

  it('masks a short value to the documented shape', () => {
    expect(partialMask('4242')).toBe('**** 4242');
  });

  it('leaves only the last four of a longer value', () => {
    expect(partialMask('Ada Lovelace')).toBe('********lace');
  });

  it('is idempotent, because the console adapter masks a second time', () => {
    expect(partialMask(partialMask('ada@example.com'))).toBe('a***@example.com');
    expect(partialMask(partialMask('4242'))).toBe('**** 4242');
  });
});

describe('maskRow — default (no unmask)', () => {
  it('fully redacts high PII and partially masks low PII', () => {
    const masked = maskRow('kyc_cases', KYC_ROW, NO_GRANT);
    expect(masked.dateOfBirth).toBe(REDACTED);
    expect(masked.taxId).toBe(REDACTED);
    expect(masked.documentUrl).toBe(REDACTED);
    expect(masked.legalName).toBe('********lace');
    expect(masked.status).toBe('pending');
  });

  it('never leaks high PII into a serialized payload', () => {
    // What actually crosses the server/client boundary in Next.js is the JSON, so
    // that is what the assertion looks at.
    const payload = JSON.stringify([
      maskRow('kyc_cases', KYC_ROW, NO_GRANT),
      maskRow('refunds', REFUND_ROW, AGENT),
    ]);
    expect(payload).not.toContain('900000001');
    expect(payload).not.toContain('1815-12-10');
    expect(payload).not.toContain('files.example.invalid');
    expect(payload).not.toContain('Ada Lovelace');
    expect(payload).not.toContain('ada@example.com');
    expect(payload).toContain('a***@example.com');
    expect(payload).toContain('**** 4242');
  });

  it('does not mutate the row it was given', () => {
    const row = { ...KYC_ROW };
    maskRow('kyc_cases', row, NO_GRANT);
    expect(row.taxId).toBe('900000001');
  });

  it('leaves tables with no classified columns alone', () => {
    expect(maskValues('feature_flags', { key: 'f', enabled: true })).toEqual({
      key: 'f',
      enabled: true,
    });
  });

  it('writes no audit row for an ordinary masked read', () => {
    maskRow('kyc_cases', KYC_ROW, NO_GRANT);
    expect(raw().prepare('select count(*) as n from audit_log').get()).toEqual({ n: 0 });
  });
});

describe('maskRow — unmask', () => {
  it('returns clear values and audits the fact for a granted actor', () => {
    const clear = maskRow('kyc_cases', KYC_ROW, GRANTED, { unmask: true });
    expect(clear.taxId).toBe('900000001');

    const rows = raw()
      .prepare('select action, decision, actor_email from audit_log')
      .all() as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      { action: 'pii.unmask', decision: 'allow', actor_email: 'r@example.com' },
    ]);
  });

  it('records the fields looked at, not their values', () => {
    maskRow('kyc_cases', KYC_ROW, GRANTED, { unmask: true });
    const [row] = raw().prepare('select diff from audit_log').all() as Array<{ diff: string }>;
    expect(row?.diff).toContain('taxId');
    expect(row?.diff).not.toContain('900000001');
  });

  it('refuses and audits when the role may never unmask', () => {
    expect(() => maskRow('refunds', REFUND_ROW, AGENT, { unmask: true })).toThrow(PolicyDeniedError);
    expect(raw().prepare(`select count(*) as n from audit_log where decision = 'deny'`).get()).toEqual({
      n: 1,
    });
  });

  it('refuses when the role may unmask but holds no grant', () => {
    expect(() => maskRow('kyc_cases', KYC_ROW, NO_GRANT, { unmask: true })).toThrow(/grant/);
  });

  it('refuses when the grant has expired', () => {
    expect(() => maskRow('kyc_cases', KYC_ROW, EXPIRED, { unmask: true })).toThrow(/grant/);
  });

  it('refuses when the grant is for a different resource type', () => {
    const elsewhere: Actor = {
      ...NO_GRANT,
      unmaskGrants: [{ resourceType: 'refunds', expiresAt: '2025-03-01T01:00:00.000Z' }],
    };
    expect(() => maskRow('kyc_cases', KYC_ROW, elsewhere, { unmask: true })).toThrow(/grant/);
  });
});
