/**
 * Per-tool custom behaviour, keyed by spec key.
 *
 * The shell is generic: it resolves actions from a spec, records them, and requests
 * approvals. What an action *does* to a domain row is the tool's business, and a spec
 * cannot express it. Rather than let the generic routes grow `if (tool === 'kyc')`,
 * each tool registers its effects here and the routes look them up — so adding the
 * next tool touches this table and one file, not the shell.
 */
import type { Actor, Row } from '../core-adapter/index';
import { KYC_SPEC_KEY, kycPatchFor, kycRequiresApproval, type PatchResult } from './kyc-review';

export type ToolEffects = {
  /** Extra approval trigger, OR-ed with the spec's threshold. Can only add a hop. */
  requiresApproval: (actionKey: string, row: Row) => boolean;
  /** The column patch an action applies, or why the case's state forbids it. */
  patchFor: (actionKey: string, row: Row, actor: Actor) => PatchResult;
  /**
   * The permission a *checker* acts under when applying an approved action. A maker's
   * permission is not usable here: a kyc_approver holds `kyc.approve`, not
   * `kyc.review`, and asking can() the wrong question would deny every sign-off.
   */
  applyPermission: string;
};

const EFFECTS: Readonly<Record<string, ToolEffects>> = {
  [KYC_SPEC_KEY]: {
    requiresApproval: kycRequiresApproval,
    patchFor: kycPatchFor,
    applyPermission: 'kyc.approve',
  },
};

export function effectsFor(specKey: string): ToolEffects | undefined {
  return EFFECTS[specKey];
}
