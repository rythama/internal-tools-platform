'use server';

/**
 * Unmask-with-reason (custom code, task step 3).
 *
 * A server action rather than a redirecting form post, for one reason: the revealed
 * values must not travel in a URL or a cookie. They are returned to the component that
 * asked for them and rendered once; a refresh is a new request, and a new request is a
 * new audited look. The decisions are `performUnmask`'s and, under it, core's.
 */
import { currentActor } from '../lib/actor';
import { performUnmask } from '../lib/perform';
import { KYC_TABLE, MIN_UNMASK_REASON_LENGTH, UNMASKABLE_FIELDS } from './kyc-review';

export type UnmaskState =
  | { status: 'idle' }
  | { status: 'revealed'; caseId: string; reason: string; fields: Record<string, string> }
  | { status: 'denied'; message: string };

export async function revealKycCase(
  _previous: UnmaskState,
  form: FormData,
): Promise<UnmaskState> {
  const caseId = String(form.get('caseId') ?? '');
  const reason = String(form.get('reason') ?? '');
  const actor = await currentActor();

  const outcome = performUnmask({
    actor,
    table: KYC_TABLE,
    id: caseId,
    fields: UNMASKABLE_FIELDS,
    reason,
    minReasonLength: MIN_UNMASK_REASON_LENGTH,
  });

  if (outcome.status === 'denied') return { status: 'denied', message: outcome.message };
  return { status: 'revealed', caseId, reason: reason.trim(), fields: outcome.fields };
}
