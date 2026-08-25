/**
 * KYC case review (devin/tasks/03-kyc-review-tool.md).
 *
 * Everything the platform can express declaratively lives here: the queue and its SLA
 * ordering, which fields the detail view shows, and which actions exist with what
 * permission and what approval requirement. There is no logic in this file, because a
 * spec that can contain logic is a spec nobody can audit at a glance.
 *
 * Two requirements the spec model cannot state, and which therefore live in
 * `apps/console/src/tools/kyc-review.ts` next to a comment saying so:
 *   - the approval trigger is `sanctionsHit || riskScore >= 80`; `approvalThreshold`
 *     is a single numeric `>` on one field, so the riskScore half is declared here and
 *     the sanctions half is a tool-supplied predicate that can only ADD an approval;
 *   - the status transition each action performs, and the unmask-with-reason flow.
 */
import type { ToolSpec } from '@itp/core';

/** riskScore >= 80 expressed in the model the platform has: strictly greater than 79. */
export const RISK_APPROVAL_THRESHOLD = 79;

export const spec: ToolSpec = {
  key: 'kyc-review',
  title: 'KYC review',
  description:
    'Verify customer identity submissions. Cases with a sanctions hit or a risk score of 80+ need a second signature.',
  visibleTo: ['kyc_reviewer', 'kyc_approver', 'auditor', 'admin'],
  queue: {
    table: 'kyc_cases',
    columns: [
      { field: 'id', label: 'Case', width: 110 },
      { field: 'status', label: 'Status', width: 110 },
      { field: 'riskScore', label: 'Risk', width: 70 },
      { field: 'sanctionsHit', label: 'Sanctions', width: 90 },
      { field: 'country', label: 'Country', width: 80 },
      { field: 'legalName', label: 'Customer' },
      { field: 'slaDueAt', label: 'SLA due' },
    ],
    filters: [
      {
        field: 'status',
        label: 'Status',
        options: ['pending', 'in_review', 'escalated', 'approved', 'rejected'],
      },
      { field: 'sanctionsHit', label: 'Sanctions hit', options: ['yes', 'no'] },
    ],
    // Soonest deadline first: the queue is ordered by breach risk, not arrival.
    defaultSort: { field: 'slaDueAt', dir: 'asc' },
    sla: { dueField: 'slaDueAt' },
  },
  detail: {
    sections: [
      {
        label: 'Case',
        fields: ['id', 'status', 'riskScore', 'sanctionsHit', 'assignedTo'],
      },
      // dateOfBirth and taxId are classified 'high' in schema.ts and arrive redacted;
      // seeing them is a separate, audited action, not a property of this view.
      { label: 'Customer', fields: ['legalName', 'dateOfBirth', 'taxId', 'country'] },
      { label: 'Timeline', fields: ['submittedAt', 'slaDueAt'] },
      { label: 'Documents', fields: ['documentUrl'] },
    ],
  },
  actions: [
    {
      key: 'start_review',
      label: 'Start review',
      permission: 'kyc.review',
      intent: 'neutral',
    },
    {
      key: 'approve',
      label: 'Approve case',
      permission: 'kyc.review',
      intent: 'positive',
      approval: { requiredApprovals: 1, disallowSelfApproval: true },
      approvalThreshold: { field: 'riskScore', gt: RISK_APPROVAL_THRESHOLD },
    },
    {
      key: 'reject',
      label: 'Reject case',
      permission: 'kyc.review',
      intent: 'destructive',
    },
    {
      key: 'escalate',
      label: 'Escalate',
      permission: 'kyc.review',
      intent: 'neutral',
    },
  ],
};
