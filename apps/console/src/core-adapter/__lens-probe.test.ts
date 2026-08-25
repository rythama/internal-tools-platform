/** TEMP probe (review scratch) — deleted after running. */
import { describe, expect, it, vi } from 'vitest';

// Simulate Session 1 landing a PARTIAL core: real can(), nothing else.
vi.mock('@itp/core', () => ({
  can: (_a: unknown, action: string) => ({
    allowed: action === 'record.purge',
    reason: `REAL-CORE says ${action}`,
  }),
}));

describe('partial core', () => {
  it('reports what the adapter binds', async () => {
    const adapter = await import('./index');
    const stubs = await import('./stub-runtime');
    console.log('PROBE coreIsImplemented =', adapter.coreIsImplemented);
    console.log('PROBE withAudit is stub  =', adapter.withAudit === stubs.stubWithAudit);
    console.log('PROBE castVote is stub   =', adapter.castVote === stubs.stubCastVote);
    console.log('PROBE verify is stub     =', adapter.verifyAuditChain === stubs.stubVerifyAuditChain);
    console.log('PROBE requestApproval stub=', adapter.requestApproval === stubs.stubRequestApproval);
    console.log('PROBE can via real core  =', JSON.stringify(adapter.can({} as never, 'record.review', { type: 't', id: '1' })));

    const actor = { sub: 'u-1', email: 'a@b.c', roles: ['kyc_reviewer'] } as never;
    // real can() DENIES record.review; stub can() ALLOWS it. Which one gates the write?
    const out = adapter.withAudit({
      actor,
      action: 'record.review',
      resource: { type: 'demo_records', id: 'REC-1' },
      mutate: () => 'MUTATION RAN',
    });
    console.log('PROBE mutate result under real-deny =', out);
    console.log('PROBE audit tail =', JSON.stringify(adapter.listAuditRows(actor).at(-1)));
    expect(true).toBe(true);
  });
});
