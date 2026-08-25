import { describe, expect, it } from 'vitest';
import type { Actor, Decision, Resource, ToolSpec } from '@itp/core';
import { applyFilters, resolveActions, slaState, sortRows } from './logic';

const spec: ToolSpec = {
  key: 'demo',
  title: 'Demo',
  description: 'test spec',
  visibleTo: ['kyc_reviewer'],
  queue: {
    table: 'demo_records',
    columns: [{ field: 'id', label: 'Id' }],
    filters: [{ field: 'status', label: 'Status', options: ['open', 'closed'] }],
    defaultSort: { field: 'id', dir: 'asc' },
    sla: { dueField: 'dueAt' },
  },
  detail: { sections: [{ label: 'Record', fields: ['id', 'status'] }] },
  actions: [
    { key: 'triage', label: 'Triage', permission: 'record.review', intent: 'neutral' },
    {
      key: 'close',
      label: 'Close',
      permission: 'record.review',
      intent: 'positive',
      approval: { requiredApprovals: 1, disallowSelfApproval: true },
      approvalThreshold: { field: 'score', gt: 79 },
    },
    { key: 'purge', label: 'Purge', permission: 'record.purge', intent: 'destructive' },
  ],
};

const actor: Actor = { sub: 'u1', email: 'u1@example.com', roles: ['kyc_reviewer'] };
const resource: Resource = { type: 'demo_records', id: 'REC-1' };

const can = (_actor: Actor, action: string): Decision =>
  action === 'record.review'
    ? { allowed: true, reason: 'maker may act' }
    : { allowed: false, reason: `no rule grants ${action}` };

describe('queue view logic', () => {
  const rows = [
    { id: 'b', status: 'open', score: 10 },
    { id: 'a', status: 'closed', score: 90 },
    { id: 'c', status: 'open', score: 50 },
  ];

  it('filters on declared fields only, by exact match', () => {
    expect(applyFilters(rows, { status: 'open' }).map((row) => row['id'])).toEqual(['b', 'c']);
    expect(applyFilters(rows, { status: '' })).toHaveLength(3);
  });

  it('sorts numerically for numbers and lexically otherwise', () => {
    expect(sortRows(rows, { field: 'score', dir: 'desc' }).map((row) => row['score'])).toEqual([90, 50, 10]);
    expect(sortRows(rows, { field: 'id', dir: 'asc' }).map((row) => row['id'])).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input rows', () => {
    sortRows(rows, { field: 'id', dir: 'desc' });
    expect(rows.map((row) => row['id'])).toEqual(['b', 'a', 'c']);
  });
});

describe('SLA badge', () => {
  const now = new Date('2025-01-01T12:00:00.000Z');

  it('is breached once the due timestamp is in the past', () => {
    expect(slaState('2025-01-01T11:59:00.000Z', now)).toBe('breached');
  });

  it('warns inside the last four hours and is otherwise fine', () => {
    expect(slaState('2025-01-01T14:00:00.000Z', now)).toBe('due-soon');
    expect(slaState('2025-01-02T14:00:00.000Z', now)).toBe('ok');
  });

  it('renders nothing for a missing or unparseable value', () => {
    expect(slaState(undefined, now)).toBe('none');
    expect(slaState('not a date', now)).toBe('none');
  });
});

describe('resolveActions', () => {
  it('offers only actions can() allows, and explains the rest', () => {
    const { allowed, denied } = resolveActions({
      spec,
      row: { id: 'REC-1', score: 10 },
      actor,
      resource,
      can,
    });
    expect(allowed.map((action) => action.key)).toEqual(['triage', 'close']);
    expect(denied.map((action) => action.key)).toEqual(['purge']);
    expect(denied[0]?.reason).toContain('record.purge');
  });

  it('renders an action needing a second signature as "Request approval"', () => {
    const { allowed } = resolveActions({
      spec,
      row: { id: 'REC-1', score: 95 },
      actor,
      resource,
      can,
    });
    const close = allowed.find((action) => action.key === 'close');
    expect(close?.mode).toBe('request');
    expect(close?.label).toBe('Request approval: Close');
  });

  it('skips the approval hop below the declared threshold', () => {
    const { allowed } = resolveActions({
      spec,
      row: { id: 'REC-1', score: 79 },
      actor,
      resource,
      can,
    });
    expect(allowed.find((action) => action.key === 'close')?.mode).toBe('direct');
  });

  it('always requires approval when the spec declares one without a threshold', () => {
    const unconditional: ToolSpec = {
      ...spec,
      actions: [
        {
          key: 'close',
          label: 'Close',
          permission: 'record.review',
          intent: 'positive',
          approval: { requiredApprovals: 2, disallowSelfApproval: true },
        },
      ],
    };
    const { allowed } = resolveActions({ spec: unconditional, row: { id: 'REC-1' }, actor, resource, can });
    expect(allowed[0]?.mode).toBe('request');
  });
});
