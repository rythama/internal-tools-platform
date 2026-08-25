/**
 * Demo fixture for the shell itself.
 *
 * Session 1 owns the seeded database and Session 3 owns the first real tool, so this
 * branch has neither. Rather than ship a console that can only render an empty state,
 * the shell falls back to one deliberately generic spec over an in-memory table: no
 * domain vocabulary, no business rules, nothing a real tool would inherit. It is
 * registered ONLY when `tools/index.ts` is empty, so it disappears the moment a real
 * spec lands.
 */
import type { ToolSpec } from '@itp/core';
import { seedStubTable, type StubRow } from './stub-runtime';

export const DEMO_TABLE = 'demo_records';

export const demoSpec: ToolSpec = {
  key: 'demo-records',
  title: 'Demo records',
  description: 'Generic spec used to exercise the console shell until a real tool ships.',
  visibleTo: ['kyc_reviewer', 'kyc_approver', 'auditor', 'admin'],
  queue: {
    table: DEMO_TABLE,
    columns: [
      { field: 'id', label: 'Record', width: 120 },
      { field: 'status', label: 'Status', width: 120 },
      { field: 'score', label: 'Score', width: 80 },
      { field: 'owner', label: 'Owner' },
      { field: 'dueAt', label: 'Due' },
    ],
    filters: [{ field: 'status', label: 'Status', options: ['open', 'in_review', 'closed'] }],
    defaultSort: { field: 'dueAt', dir: 'asc' },
    sla: { dueField: 'dueAt' },
  },
  detail: {
    sections: [
      { label: 'Record', fields: ['id', 'status', 'score', 'owner', 'dueAt'] },
      { label: 'Contact', fields: ['contactEmail', 'reference'] },
    ],
  },
  actions: [
    {
      key: 'triage',
      label: 'Mark in review',
      permission: 'record.review',
      intent: 'neutral',
    },
    {
      key: 'close',
      label: 'Close record',
      permission: 'record.review',
      intent: 'positive',
      approval: { requiredApprovals: 1, disallowSelfApproval: true },
      approvalThreshold: { field: 'score', gt: 79 },
    },
    {
      key: 'purge',
      label: 'Purge record',
      permission: 'record.purge',
      intent: 'destructive',
    },
  ],
};

const STATUSES = ['open', 'in_review', 'closed'] as const;

function demoRows(): StubRow[] {
  const base = Date.parse('2025-01-01T12:00:00.000Z');
  return Array.from({ length: 12 }, (_, index) => {
    const hoursOffset = [-30, -6, -1, 2, 3, 9, 20, 40, 55, 70, 90, 120][index] ?? 0;
    return {
      id: `REC-${String(1000 + index)}`,
      status: STATUSES[index % STATUSES.length],
      score: (index * 13) % 100,
      owner: index % 2 === 0 ? 'ops-team-a' : 'ops-team-b',
      dueAt: new Date(base + hoursOffset * 3_600_000).toISOString(),
      contactEmail: `customer${index}@example.com`,
      reference: `REF-${(index * 7919) % 100000}`,
    };
  });
}

let installed = false;

/** Idempotent: route handlers and page renders both call it. */
export function installDemoFixtures(): void {
  if (installed) return;
  seedStubTable(DEMO_TABLE, demoRows(), { contactEmail: 'low', reference: 'high' });
  installed = true;
}
