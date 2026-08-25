/**
 * Refund review (devin/tasks/04-tools-two-and-three.md).
 *
 * The dual-control boundary is one number on one field, which is exactly the shape
 * `approvalThreshold` exists for — so the whole approval requirement is declared here
 * and enforced by the existing approvals primitive. The threshold constant is
 * imported from the policy module rather than restated, because the same limit is
 * enforced a second time by the `refund-maker-under-limit` rule: the spec routes
 * over-limit refunds to maker–checker, and the policy denies an agent issuing one
 * even if that routing ever broke.
 *
 * What the spec cannot say — the status transition each action performs — lives in
 * `apps/console/src/tools/refunds.ts` next to a comment saying so.
 */
import type { ToolSpec } from '@itp/core';
import { REFUND_SELF_SERVICE_LIMIT_CENTS } from '@itp/core';

export const spec: ToolSpec = {
  key: 'refunds',
  title: 'Refunds',
  description:
    'Review customer refund requests. Refunds over $500 need a refund approver’s second signature.',
  visibleTo: ['refund_agent', 'refund_approver', 'auditor', 'admin'],
  queue: {
    table: 'refunds',
    columns: [
      { field: 'id', label: 'Refund', width: 110 },
      { field: 'status', label: 'Status', width: 130 },
      { field: 'amountCents', label: 'Amount (¢)', width: 100 },
      { field: 'currency', label: 'Currency', width: 80 },
      { field: 'customerEmail', label: 'Customer' },
      { field: 'reason', label: 'Reason' },
      { field: 'requestedAt', label: 'Requested' },
    ],
    filters: [
      {
        field: 'status',
        label: 'Status',
        options: ['requested', 'pending_approval', 'approved', 'rejected', 'settled'],
      },
    ],
    // Largest exposure first: the queue is ordered by money at stake, not arrival.
    defaultSort: { field: 'amountCents', dir: 'desc' },
  },
  detail: {
    sections: [
      { label: 'Refund', fields: ['id', 'status', 'amountCents', 'currency', 'reason'] },
      // customerEmail and cardLast4 are classified 'low' in schema.ts and arrive
      // partially masked; this view never sees them in clear.
      { label: 'Customer', fields: ['customerEmail', 'cardLast4'] },
      { label: 'Timeline', fields: ['requestedAt', 'settlementKey'] },
    ],
  },
  actions: [
    {
      key: 'approve',
      label: 'Approve refund',
      permission: 'refund.issue',
      intent: 'positive',
      approval: { requiredApprovals: 1, disallowSelfApproval: true },
      approvalThreshold: { field: 'amountCents', gt: REFUND_SELF_SERVICE_LIMIT_CENTS },
    },
    {
      // Rejection moves no money, so it is gated on the generic maker permission
      // rather than `refund.issue`: an agent may decline a refund of any size.
      key: 'reject',
      label: 'Reject refund',
      permission: 'record.review',
      intent: 'destructive',
    },
  ],
};
