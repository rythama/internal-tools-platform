/**
 * Deterministic development seed.
 *
 * Same input, same database, same hash chain — a seed that varies would make
 * `audit:verify` unreproducible and the chain impossible to reason about in review.
 * Randomness comes from a fixed-seed PRNG and the clock is pinned.
 *
 * Fake data only: names, tax IDs and card digits below are generated, and the tax
 * IDs use the 900-series range that is never issued.
 */
import { useFixedClock, useSystemClock } from '../clock.js';
import { requestApproval, castVote } from '../approvals/index.js';
import { verifyAuditChain, withAudit } from '../audit/index.js';
import { closeDatabase, databasePath, db, raw } from './client.js';
import { featureFlags, kycCases, refunds } from './schema.js';
import type { Actor } from '../types.js';

const SEED_EPOCH = '2025-01-06T09:00:00.000Z';

/** mulberry32: tiny, seeded, and stable across Node versions. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = ['Ada', 'Bo', 'Chen', 'Dara', 'Emeka', 'Fatima', 'Gus', 'Hana', 'Ivo', 'Jun'];
const LAST_NAMES = ['Ali', 'Bergman', 'Costa', 'Duarte', 'Eriksen', 'Farid', 'Gomez', 'Haruna'];
const COUNTRIES = ['US', 'GB', 'DE', 'NG', 'BR', 'SG'];
const KYC_STATUSES = ['pending', 'in_review', 'escalated', 'approved', 'rejected'] as const;
const REFUND_REASONS = [
  'duplicate charge',
  'service not rendered',
  'customer dispute',
  'pricing error',
  'goodwill',
];

function iso(base: number, hours: number): string {
  return new Date(base + hours * 3_600_000).toISOString();
}

function pick<T>(values: readonly T[], random: () => number): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) throw new Error('pick from an empty list');
  return value;
}

export function seedDomainTables(): void {
  const random = prng(20250106);
  const epoch = Date.parse(SEED_EPOCH);
  const database = db();

  database.delete(kycCases).run();
  database.delete(refunds).run();
  database.delete(featureFlags).run();

  // ~40 KYC cases: risk spread across the 80-point approval threshold, and a third
  // of them already past their SLA so the queue has something red in it.
  const cases = Array.from({ length: 40 }, (_, index) => {
    const riskScore = Math.floor(random() * 100);
    const submittedHours = -Math.floor(random() * 120);
    const slaHours = submittedHours + (index % 3 === 0 ? 12 : 72);
    return {
      id: `KYC-${1000 + index}`,
      status: pick(KYC_STATUSES, random),
      riskScore,
      submittedAt: iso(epoch, submittedHours),
      slaDueAt: iso(epoch, slaHours),
      assignedTo: index % 4 === 0 ? 'u-reviewer' : null,
      legalName: `${pick(FIRST_NAMES, random)} ${pick(LAST_NAMES, random)}`,
      dateOfBirth: `19${60 + (index % 40)}-0${1 + (index % 9)}-1${index % 10}`,
      // 900-series prefixes are never issued as real tax IDs.
      taxId: `9${String(10_000_0000 + index * 7919).slice(0, 8)}`,
      country: pick(COUNTRIES, random),
      documentUrl: `https://files.example.invalid/kyc/${1000 + index}.pdf`,
      sanctionsHit: riskScore > 92,
    };
  });
  database.insert(kycCases).values(cases).run();

  // ~25 refunds spanning the $500 approval threshold in both directions.
  const refundRows = Array.from({ length: 25 }, (_, index) => ({
    id: `RFD-${2000 + index}`,
    status: (index % 5 === 0 ? 'pending_approval' : 'requested') as 'pending_approval' | 'requested',
    amountCents: index % 2 === 0 ? 1_500 + index * 700 : 51_000 + index * 4_300,
    currency: 'USD',
    customerEmail: `customer${index}@example.com`,
    cardLast4: String(4000 + index).slice(-4),
    reason: pick(REFUND_REASONS, random),
    requestedAt: iso(epoch, -Math.floor(random() * 200)),
    settlementKey: null,
  }));
  database.insert(refunds).values(refundRows).run();

  const flags = Array.from({ length: 12 }, (_, index) => ({
    key: `feature.${['payouts', 'kyc_v2', 'refunds_ui', 'dark_mode'][index % 4]}.${index}`,
    description: `Prototype flag ${index}`,
    enabled: index % 3 === 0,
    rolloutPercent: (index * 9) % 101,
    environment: (['dev', 'staging', 'prod'] as const)[index % 3] ?? 'dev',
    updatedAt: iso(epoch, -index),
  }));
  database.insert(featureFlags).values(flags).run();
}

const REVIEWER: Actor = {
  sub: 'u-reviewer',
  email: 'rina.reviewer@example.com',
  roles: ['kyc_reviewer'],
};
const APPROVER: Actor = {
  sub: 'u-approver',
  email: 'adam.approver@example.com',
  roles: ['kyc_approver'],
};

/**
 * A seeded chain with nothing on it proves nothing, so the seed exercises the
 * primitives: an allowed action, a denial, and a maker-checker round trip. These are
 * the rows `npm run audit:verify` walks in CI.
 */
function seedAuditChain(): void {
  const resource = { type: 'kyc_cases', id: 'KYC-1000', attrs: { riskScore: 91 } };

  withAudit({
    actor: REVIEWER,
    action: 'record.review',
    resource,
    diff: { status: { before: 'pending', after: 'in_review' } },
    mutate: () => undefined,
  });

  // A denial belongs on the chain as much as a success (§3.4): the reviewer is not
  // an approver, and the attempt is the interesting record.
  try {
    withAudit({
      actor: REVIEWER,
      action: 'record.approve',
      resource,
      mutate: () => undefined,
    });
  } catch {
    // audited by withAudit before it threw
  }

  const requested = requestApproval({
    actor: REVIEWER,
    action: 'approve',
    permission: 'record.review',
    resource,
    payload: { action: 'approve' },
    requiredApprovals: 1,
    disallowSelfApproval: true,
  });

  try {
    castVote({ actor: REVIEWER, approvalId: requested.approvalId, vote: 'approve' });
  } catch {
    // four-eyes: the requester's own vote is refused, and the refusal is audited
  }

  castVote({
    actor: APPROVER,
    approvalId: requested.approvalId,
    vote: 'approve',
    note: 'documents check out',
  });
}

function main(): void {
  useFixedClock(SEED_EPOCH);
  // A re-seed starts a fresh chain: the audit table is append-only at runtime, so
  // rebuilding the dev database is a drop, not an edit.
  raw().exec('DROP TABLE IF EXISTS approval_votes; DROP TABLE IF EXISTS approvals;');
  raw().exec('DROP TRIGGER IF EXISTS audit_log_no_update; DROP TRIGGER IF EXISTS audit_log_no_delete;');
  raw().exec('DROP TABLE IF EXISTS audit_log;');
  closeDatabase();

  seedDomainTables();
  seedAuditChain();

  const integrity = verifyAuditChain();
  useSystemClock();

  if (!integrity.ok) {
    console.error(`seed produced a broken chain at seq ${integrity.brokenAtSeq}`);
    process.exit(1);
  }

  console.log(
    `seeded ${databasePath()}: 40 kyc cases, 25 refunds, 12 flags, audit chain intact`,
  );
}

main();
