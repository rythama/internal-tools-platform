import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { decodeSession } from './session';
import { resolveActions } from '@itp/ui';
import { seedStubTable, stubMaskRow, resetStubStore } from '../core-adapter/index-probe-shim';
import { stubCan } from '../core-adapter/policy-stub';
import type { Actor, ToolSpec } from '@itp/core';

it('A: table seeded WITHOUT a pii map returns PII in clear', () => {
  resetStubStore();
  seedStubTable('kyc_cases', [{ id: 'K1', taxId: '123-45-6789', legalName: 'Jane Doe' }]);
  const masked = stubMaskRow('kyc_cases',
    { id: 'K1', taxId: '123-45-6789', legalName: 'Jane Doe' },
    { sub: 'u', email: 'u@x', roles: ['kyc_reviewer'] } as Actor);
  console.log('A: masked row =', JSON.stringify(masked));
});

it('B: approvalThreshold pointing at a missing/non-numeric field => direct, no approval', () => {
  const spec = {
    key: 'refunds', title: 't', description: 'd', visibleTo: ['refund_agent'],
    queue: { table: 'refunds', columns: [] }, detail: { sections: [] },
    actions: [{
      key: 'refund', label: 'Issue refund', permission: 'record.review', intent: 'positive',
      approval: { requiredApprovals: 1, disallowSelfApproval: true },
      approvalThreshold: { field: 'amount', gt: 500 },   // real column is amountCents
    }],
  } as unknown as ToolSpec;
  const out = resolveActions({
    spec, row: { id: 'R1', amountCents: 5_000_00 },
    actor: { sub: 'u', email: 'u@x', roles: ['refund_agent'] } as Actor,
    resource: { type: 'refunds', id: 'R1' }, can: stubCan,
  });
  console.log('B: $5000 refund resolved as ->', JSON.stringify(out.allowed));
});

it('C: default secret + unvalidated unmaskGrants = forgeable admin w/ PII unmask', () => {
  const payload = Buffer.from(JSON.stringify({
    sub: 'attacker', email: 'a@evil.com', roles: ['admin'],
    unmaskGrants: [{ resourceType: 'kyc_cases', expiresAt: '2999-01-01T00:00:00.000Z' }],
  }), 'utf8').toString('base64url');
  const sig = createHmac('sha256', 'dev-only-insecure-session-secret').update(payload).digest('base64url');
  const decoded = decodeSession(`${payload}.${sig}`);
  console.log('C: decoded =', JSON.stringify(decoded));
  expect(decoded).toBeDefined();
});
