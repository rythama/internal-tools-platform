/**
 * The custom half of the refunds tool — everything `tools/refunds/spec.ts` cannot say.
 *
 * The approval trigger is fully declarative (`approvalThreshold` on `amountCents`),
 * so unlike KYC there is no predicate here. What remains custom is the status
 * transition each action performs: the platform records actions and gates them, and
 * what "approve" does to a refund is domain knowledge. Transitions are declared as a
 * table of legal source states so an action arriving for a refund in the wrong state
 * is refused (and audited) rather than silently applied.
 */
import type { Actor, Row } from '../core-adapter/index';
import type { PatchResult } from './kyc-review';

export const REFUNDS_SPEC_KEY = 'refunds';
export const REFUNDS_TABLE = 'refunds';

type Status = 'requested' | 'pending_approval' | 'approved' | 'rejected' | 'settled';

type Transition = { from: readonly Status[]; to: Status };

const TRANSITIONS: Readonly<Record<string, Transition>> = {
  approve: { from: ['requested', 'pending_approval'], to: 'approved' },
  reject: { from: ['requested', 'pending_approval'], to: 'rejected' },
};

/** The spec's threshold is the whole trigger; nothing to add. */
export function refundRequiresApproval(): boolean {
  return false;
}

/** What an action does to a refund, or why its state forbids it. */
export function refundPatchFor(actionKey: string, row: Row, _actor: Actor): PatchResult {
  const transition = TRANSITIONS[actionKey];
  if (!transition) return { ok: false, reason: `no transition defined for “${actionKey}”` };

  const status = row['status'];
  if (typeof status !== 'string' || !transition.from.includes(status as Status)) {
    return {
      ok: false,
      reason: `a refund in status “${String(status)}” cannot be ${actionKey}d; expected ${transition.from.join(' or ')}`,
    };
  }

  return { ok: true, patch: { status: transition.to } };
}
