import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Actor, Decision, ToolSpec } from '@itp/core';
import { ActionBar } from './action-bar';
import { ApprovalPanel, type ApprovalView } from './approval-panel';
import { AuditChain } from './audit-chain';
import { Detail } from './detail';
import { Queue } from './queue';

const spec: ToolSpec = {
  key: 'demo',
  title: 'Demo',
  description: 'test spec',
  visibleTo: ['kyc_reviewer'],
  queue: {
    table: 'demo_records',
    columns: [
      { field: 'id', label: 'Id' },
      { field: 'status', label: 'Status' },
    ],
    filters: [{ field: 'status', label: 'Status', options: ['open', 'closed'] }],
    sla: { dueField: 'dueAt' },
  },
  detail: { sections: [{ label: 'Record', fields: ['id', 'taxId'] }] },
  actions: [
    {
      key: 'close',
      label: 'Close',
      permission: 'record.review',
      intent: 'positive',
      approval: { requiredApprovals: 1, disallowSelfApproval: true },
    },
    { key: 'purge', label: 'Purge', permission: 'record.purge', intent: 'destructive' },
  ],
};

const actor: Actor = { sub: 'u1', email: 'u1@example.com', roles: ['kyc_reviewer'] };
const allowReview = (_a: Actor, action: string): Decision =>
  action === 'record.review'
    ? { allowed: true, reason: 'maker may act' }
    : { allowed: false, reason: 'deny by default' };

describe('<Queue>', () => {
  it('renders a red SLA badge for a breached row and links the first column', () => {
    const html = renderToStaticMarkup(
      <Queue
        spec={spec}
        rows={[{ id: 'REC-1', status: 'open', dueAt: '2025-01-01T00:00:00.000Z' }]}
        basePath="/t/demo"
        now={new Date('2025-01-02T00:00:00.000Z')}
      />,
    );
    expect(html).toContain('badge-sla-breached');
    expect(html).toContain('href="/t/demo/REC-1"');
  });

  it('renders an empty state rather than a bare table', () => {
    const html = renderToStaticMarkup(<Queue spec={spec} rows={[]} basePath="/t/demo" />);
    expect(html).toContain('No rows match this view.');
  });
});

describe('<Detail>', () => {
  it('renders masked values exactly as returned and marks them', () => {
    const html = renderToStaticMarkup(<Detail spec={spec} row={{ id: 'REC-1', taxId: '[redacted]' }} />);
    expect(html).toContain('[redacted]');
    expect(html).toContain('masked');
  });
});

describe('<ActionBar>', () => {
  const html = renderToStaticMarkup(
    <ActionBar
      spec={spec}
      row={{ id: 'REC-1' }}
      actor={actor}
      resource={{ type: 'demo_records', id: 'REC-1' }}
      can={allowReview}
      endpoint="/api/act"
    />,
  );

  it('offers an approval-gated action as a request, not as the action', () => {
    expect(html).toContain('Request approval: Close');
  });

  it('does not offer a denied action as a button, and shows why', () => {
    expect(html).not.toContain('value="purge"');
    expect(html).toContain('deny by default');
  });
});

describe('<ApprovalPanel>', () => {
  const approval: ApprovalView = {
    approvalId: 1,
    action: 'close',
    resourceType: 'demo_records',
    resourceId: 'REC-1',
    state: 'pending',
    requestedBy: 'u1',
    requestedAt: '2025-01-01T00:00:00.000Z',
    requiredApprovals: 1,
    votes: [{ voterSub: 'u2', vote: 'approve', votedAt: '2025-01-01T01:00:00.000Z', note: 'looks fine' }],
  };

  it('shows the vote trail whether or not the actor may vote', () => {
    const html = renderToStaticMarkup(
      <ApprovalPanel
        approvals={[approval]}
        canVote={() => ({ allowed: false, reason: 'You requested this.' })}
        endpoint="/api/vote"
      />,
    );
    expect(html).toContain('looks fine');
    expect(html).toContain('You requested this.');
    expect(html).not.toContain('value="approve"');
  });

  it('renders approve and reject when the actor may vote', () => {
    const html = renderToStaticMarkup(
      <ApprovalPanel approvals={[approval]} canVote={() => ({ allowed: true, reason: 'checker' })} endpoint="/api/vote" />,
    );
    expect(html).toContain('value="approve"');
    expect(html).toContain('value="reject"');
  });
});

describe('<AuditChain>', () => {
  const row = {
    seq: 1,
    occurredAt: '2025-01-01T00:00:00.000Z',
    actorEmail: 'u1@example.com',
    action: 'record.review',
    resourceType: 'demo_records',
    resourceId: 'REC-1',
    decision: 'deny' as const,
    decisionReason: 'deny by default',
    prevHash: '0'.repeat(64),
    hash: 'abc123abc123abc123',
  };

  it('shows a green banner when the chain verifies', () => {
    const html = renderToStaticMarkup(<AuditChain rows={[row]} integrity={{ ok: true }} />);
    expect(html).toContain('chain-ok');
    expect(html).toContain('Chain intact');
  });

  it('names the first broken sequence when it does not', () => {
    const html = renderToStaticMarkup(<AuditChain rows={[row]} integrity={{ ok: false, brokenAtSeq: 7 }} />);
    expect(html).toContain('chain-broken');
    expect(html).toContain('seq 7');
  });
});
