/**
 * The feature-flags workflow, centred on the prod dual-control trigger.
 *
 * Same structure as the refunds suite: every step goes through the functions the
 * routes call, and asserts both the domain change and what the chain says happened.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { listApprovals, listAuditRows, listRows, verifyAuditChain } from '@itp/core';
// Test seams are deliberately absent from core's public surface, so this suite reaches
// for them the way core's own tests do rather than widening the API for a test.
import { db, useInMemoryDatabaseForTests } from '../../../../packages/core/src/db/client';
import { featureFlags } from '../../../../packages/core/src/db/schema';
import { useFixedClock } from '../../../../packages/core/src/clock';
import type { Actor } from '../core-adapter/index';
import { performAction, performVote } from '../lib/perform';
import { spec } from '../../../../tools/feature-flags/spec';
import { FLAGS_TABLE } from './feature-flags';

const ADMIN_ONE: Actor = { sub: 'u-flag-1', email: 'fay@example.com', roles: ['flag_admin'] };
const ADMIN_TWO: Actor = { sub: 'u-flag-2', email: 'flo@example.com', roles: ['flag_admin'] };
const AUDITOR: Actor = { sub: 'u-auditor', email: 'ada@example.com', roles: ['auditor'] };

type FlagSeed = {
  key: string;
  environment: 'dev' | 'staging' | 'prod';
  enabled?: boolean;
  rolloutPercent?: number;
};

function seedFlag(seed: FlagSeed): void {
  db()
    .insert(featureFlags)
    .values({
      key: seed.key,
      description: `Flag ${seed.key}`,
      enabled: seed.enabled ?? false,
      rolloutPercent: seed.rolloutPercent ?? 0,
      environment: seed.environment,
      updatedAt: '2025-02-01T00:00:00.000Z',
    })
    .run();
}

function flagRow(key: string): Record<string, unknown> | undefined {
  return listRows<Record<string, unknown>>(FLAGS_TABLE, AUDITOR).find(
    (row) => row['key'] === key,
  );
}

/** Audit entries for one flag, oldest first. */
function trail(key: string) {
  return listAuditRows(AUDITOR)
    .filter((entry) => entry.resourceType === FLAGS_TABLE && entry.resourceId === key)
    .reverse();
}

beforeEach(() => {
  useInMemoryDatabaseForTests();
  useFixedClock('2025-03-01T00:00:00.000Z');
  seedFlag({ key: 'feature.dev', environment: 'dev' });
  seedFlag({ key: 'feature.staging', environment: 'staging', rolloutPercent: 10 });
  seedFlag({ key: 'feature.prod', environment: 'prod', enabled: false });
});

describe('dev and staging — one pair of hands', () => {
  it('toggles a dev flag directly and stamps updatedAt from the pinned clock', () => {
    const outcome = performAction({ spec, actor: ADMIN_ONE, id: 'feature.dev', actionKey: 'toggle' });
    expect(outcome).toMatchObject({ status: 'applied' });
    const row = flagRow('feature.dev');
    expect(row?.['enabled']).toBe(true);
    expect(row?.['updatedAt']).toContain('2025-03-01');
    expect(listApprovals(FLAGS_TABLE, 'feature.dev', AUDITOR)).toHaveLength(0);

    const toggles = trail('feature.dev').filter((entry) => entry.action === 'flag.toggle');
    expect(toggles.map((entry) => entry.decision)).toEqual(['allow']);
  });

  it('sets a staging rollout preset directly', () => {
    const outcome = performAction({
      spec,
      actor: ADMIN_ONE,
      id: 'feature.staging',
      actionKey: 'rollout_50',
    });
    expect(outcome).toMatchObject({ status: 'applied' });
    expect(flagRow('feature.staging')?.['rolloutPercent']).toBe(50);
  });

  it('refuses a role without flag.toggle, and audits it', () => {
    const outcome = performAction({ spec, actor: AUDITOR, id: 'feature.dev', actionKey: 'toggle' });
    expect(outcome.status).toBe('denied');
    const denial = trail('feature.dev').find((entry) => entry.decision === 'deny');
    expect(denial?.actorEmail).toBe(AUDITOR.email);
  });
});

describe('prod — four eyes on every change', () => {
  it('turns a prod toggle into an approval request', () => {
    const outcome = performAction({ spec, actor: ADMIN_ONE, id: 'feature.prod', actionKey: 'toggle' });
    expect(outcome.status).toBe('requested');
    // Crucially: nothing changed by asking.
    expect(flagRow('feature.prod')?.['enabled']).toBe(false);
    expect(listApprovals(FLAGS_TABLE, 'feature.prod', AUDITOR)).toHaveLength(1);
  });

  it('turns a prod rollout change into an approval request too', () => {
    const outcome = performAction({
      spec,
      actor: ADMIN_ONE,
      id: 'feature.prod',
      actionKey: 'rollout_100',
    });
    expect(outcome.status).toBe('requested');
    expect(flagRow('feature.prod')?.['rolloutPercent']).toBe(0);
  });

  it('will not let the requester sign their own request', () => {
    const requested = performAction({
      spec,
      actor: ADMIN_ONE,
      id: 'feature.prod',
      actionKey: 'toggle',
    });
    if (requested.status !== 'requested') throw new Error('expected an approval request');

    const selfVote = performVote({
      actor: ADMIN_ONE,
      approvalId: requested.approvalId,
      vote: 'approve',
    });
    expect(selfVote.status).toBe('denied');
    expect(flagRow('feature.prod')?.['enabled']).toBe(false);
  });

  it('applies the change once a second flag admin signs, and chains every step', () => {
    const requested = performAction({
      spec,
      actor: ADMIN_ONE,
      id: 'feature.prod',
      actionKey: 'toggle',
    });
    if (requested.status !== 'requested') throw new Error('expected an approval request');

    const vote = performVote({
      actor: ADMIN_TWO,
      approvalId: requested.approvalId,
      vote: 'approve',
    });
    expect(vote.status).toBe('ok');
    expect(flagRow('feature.prod')?.['enabled']).toBe(true);

    const actions = trail('feature.prod').map((entry) => entry.action);
    expect(actions).toContain('toggle.request');
    expect(actions).toContain('toggle.applied');
    expect(actions).toContain('flag.toggle');
    expect(verifyAuditChain().ok).toBe(true);
  });
});
