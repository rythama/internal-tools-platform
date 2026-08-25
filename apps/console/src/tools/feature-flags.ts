/**
 * The custom half of the feature-flags tool — everything
 * `tools/feature-flags/spec.ts` cannot say.
 *
 *   1. "Any prod change requires a second approver" is a string equality on
 *      `environment`; the spec model's `approvalThreshold` is a single numeric `>`
 *      on one field, so the trigger lives here as a predicate. It can only ADD an
 *      approval hop (see `resolveActions`), never remove one.
 *
 *   2. The column patch each action applies. Toggling reads the row's current state
 *      at apply time, so an approved prod toggle flips whatever the flag is when the
 *      second signature lands, not what it was when the request was made.
 */
import type { Actor, Row } from '../core-adapter/index';
import { now } from '../core-adapter/index';
import type { PatchResult } from './kyc-review';

export const FLAGS_SPEC_KEY = 'feature-flags';
export const FLAGS_TABLE = 'feature_flags';

const ROLLOUT_PRESETS: Readonly<Record<string, number>> = {
  rollout_25: 25,
  rollout_50: 50,
  rollout_100: 100,
};

/** Prod is the environment where a lone admin must not act; dev and staging are not. */
export function flagRequiresApproval(_actionKey: string, row: Row): boolean {
  return row['environment'] === 'prod';
}

/** What an action does to a flag, or why it is not a flag action at all. */
export function flagPatchFor(actionKey: string, row: Row, _actor: Actor): PatchResult {
  if (actionKey === 'toggle') {
    return { ok: true, patch: { enabled: row['enabled'] !== true, updatedAt: now() } };
  }
  const rolloutPercent = ROLLOUT_PRESETS[actionKey];
  if (rolloutPercent !== undefined) {
    return { ok: true, patch: { rolloutPercent, updatedAt: now() } };
  }
  return { ok: false, reason: `no patch defined for “${actionKey}”` };
}
