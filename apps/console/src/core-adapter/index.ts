/**
 * Binding to @itp/core.
 *
 * This used to feature-detect each contract name and fall back to an in-memory stub
 * when core shipped only declarations. Core is implemented, so the fallbacks are gone
 * along with the stub runtime: a console that can silently serve stub data is a
 * console whose demo cannot be trusted. What remains is a re-export plus the two
 * adaptations the console genuinely needs — a string-typed `maskRow` table name, and
 * the "may this actor vote" question the approval panel asks.
 */
import * as core from '@itp/core';
import type { Actor, Decision, Resource } from '@itp/core';
import type { ApprovalView, Row as UiRow } from '@itp/ui';

export type { Actor, Decision, Resource, Role, ToolSpec } from '@itp/core';
export { PolicyDeniedError } from '@itp/core';
export type Row = UiRow;

export const {
  can,
  withAudit,
  verifyAuditChain,
  requestApproval,
  castVote,
  listRows,
  getRow,
  listAuditRows,
  listApprovals,
  getApproval,
  updateRow,
  recordDenial,
} = core;

/**
 * `core.maskRow` and `core.revealRow` are typed against the classified tables; the
 * console reads its table name out of a spec, which is a plain string. The two casts
 * are confined to these wrappers rather than spread across the routes.
 */
export function maskRow<T extends Record<string, unknown>>(
  table: string,
  row: T,
  actor: Actor,
  opts?: { unmask?: boolean; reason?: string },
): T {
  return (core.maskRow as (t: string, r: T, a: Actor, o?: typeof opts) => T)(
    table,
    row,
    actor,
    opts,
  );
}

/** Unmasked read of one row. Gated by policy AND a live grant, and audited in core. */
export function revealRow(
  table: string,
  id: string,
  actor: Actor,
  reason: string,
): Row | undefined {
  return core.revealRow<Row>(table, id, actor, reason);
}

/**
 * Whether this actor may vote on this approval. Two conditions: the policy allows the
 * vote action at all, and the four-eyes rule does not bar this particular voter. Both
 * are core's answers — core re-checks them when the vote is cast, so a wrong answer
 * here can only hide a button, never authorize a signature.
 */
export function canVoteOn(actor: Actor, approval: ApprovalView): Decision {
  const resource: Resource = { type: approval.resourceType, id: approval.resourceId };
  const decision = can(actor, 'approval.vote', resource);
  if (!decision.allowed) return decision;
  if (approval.requestedBy === actor.sub) {
    return { allowed: false, reason: 'You requested this. Four-eyes: someone else must sign off.' };
  }
  if (approval.votes.some((vote) => vote.voterSub === actor.sub)) {
    return { allowed: false, reason: 'You have already voted on this approval.' };
  }
  if (approval.state !== 'pending') {
    return { allowed: false, reason: `Approval is already ${approval.state}.` };
  }
  return decision;
}
