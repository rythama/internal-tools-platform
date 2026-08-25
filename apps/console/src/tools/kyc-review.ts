/**
 * The custom half of the KYC tool — everything `tools/kyc-review/spec.ts` cannot say.
 *
 * The task allows custom code "only where the spec genuinely cannot express it". Two
 * things qualify, and both are here rather than in the shell:
 *
 *   1. The approval trigger is `sanctionsHit || riskScore >= 80`. The spec model has
 *      `approvalThreshold: { field, gt }` — one field, one numeric comparison — so the
 *      riskScore half is declared in the spec and the sanctions half is this predicate.
 *      It can only ADD an approval hop (see `resolveActions`), never remove one, so the
 *      worst a bug here can do is demand a second signature that was not required.
 *
 *   2. The status transition each action performs. The platform records actions and
 *      gates them; what "approve" does to a KYC case is domain knowledge. Transitions
 *      are declared as a table of legal source states so an action arriving for a case
 *      in the wrong state is refused (and audited) rather than silently applied.
 *
 * The unmask-with-reason flow is the third piece of custom code; it lives in the route
 * that needs a request body (`api/t/kyc-review/[id]/unmask`).
 */
import type { Actor, Row } from '../core-adapter/index';

export const KYC_SPEC_KEY = 'kyc-review';
export const KYC_TABLE = 'kyc_cases';

/** Mirrors the spec's `approvalThreshold.gt` of 79, i.e. "risk score 80 or more". */
export const RISK_APPROVAL_FLOOR = 80;

type Status = 'pending' | 'in_review' | 'escalated' | 'approved' | 'rejected';

type Transition = { from: readonly Status[]; to: Status };

const TRANSITIONS: Readonly<Record<string, Transition>> = {
  start_review: { from: ['pending'], to: 'in_review' },
  approve: { from: ['in_review', 'escalated'], to: 'approved' },
  reject: { from: ['pending', 'in_review', 'escalated'], to: 'rejected' },
  escalate: { from: ['pending', 'in_review'], to: 'escalated' },
};

/**
 * The sanctions half of the trigger. A case flagged against a sanctions list needs a
 * second signature whatever its score, which is a boolean on a different field from
 * the numeric threshold the spec declares — two fields, so out of the model's reach.
 */
export function kycRequiresApproval(actionKey: string, row: Row): boolean {
  if (actionKey !== 'approve') return false;
  return row['sanctionsHit'] === true;
}

/** Human-readable justification for the extra hop, for the flash message. */
export function approvalTrigger(row: Row): string | undefined {
  if (row['sanctionsHit'] === true) return 'sanctions hit';
  const score = row['riskScore'];
  if (typeof score === 'number' && score >= RISK_APPROVAL_FLOOR) return `risk score ${score}`;
  return undefined;
}

export type PatchResult =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * What an action does to a case, or why it may not. `actor` is used to record who
 * picked the case up; the patch never contains a classified column.
 */
export function kycPatchFor(actionKey: string, row: Row, actor: Actor): PatchResult {
  const transition = TRANSITIONS[actionKey];
  if (!transition) return { ok: false, reason: `no transition defined for “${actionKey}”` };

  const status = row['status'];
  if (typeof status !== 'string' || !transition.from.includes(status as Status)) {
    return {
      ok: false,
      reason: `a case in status “${String(status)}” cannot be ${actionKey.replace('_', ' ')}d; expected ${transition.from.join(' or ')}`,
    };
  }

  const patch: Record<string, unknown> = { status: transition.to };
  if (actionKey === 'start_review') patch['assignedTo'] = actor.sub;
  return { ok: true, patch };
}

/** Fields the reviewer may ask to see in clear, i.e. the ones classified 'high'. */
export const UNMASKABLE_FIELDS = ['dateOfBirth', 'taxId', 'documentUrl'] as const;

export const MIN_UNMASK_REASON_LENGTH = 10;
