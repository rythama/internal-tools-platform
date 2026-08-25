/**
 * Thin adapter over @itp/core.
 *
 * `packages/core/src/index.ts` currently declares its contract without shipping an
 * implementation — Session 1 is writing one in parallel. This module binds each
 * declared name at runtime: the real export when it exists, the local stub otherwise.
 * The console imports only from here, so the day core lands the console changes in
 * exactly one file (and this file collapses to a re-export).
 *
 * It also declares four *read* functions the contract does not yet have. See
 * `CoreReadExtensions` below — the console cannot render a queue, a detail page,
 * an approvals panel or the audit view without them, and per ARCHITECTURE.md they
 * must not come from a direct database call in a component.
 */
import * as core from '@itp/core';
import type { Actor, Decision, Resource } from '@itp/core';
import type { ApprovalView, AuditRowView } from '@itp/ui';
import { stubCan } from './policy-stub';
import {
  PolicyDeniedError,
  stubCastVote,
  stubGetRow,
  stubListApprovals,
  stubListAuditRows,
  stubListRows,
  stubMaskRow,
  stubRequestApproval,
  stubSelfApprovalBlocked,
  stubVerifyAuditChain,
  stubWithAudit,
  type StubRow,
} from './stub-runtime';

export type { Actor, Decision, Resource, Role, ToolSpec } from '@itp/core';
export { PolicyDeniedError } from './stub-runtime';
export type Row = StubRow;

/**
 * Reads the console needs and the declared contract does not provide. Proposed for
 * packages/core rather than implemented here: a query API is a core concern, not a
 * console one. Until then the adapter serves them from the stub store.
 */
type CoreReadExtensions = {
  listRows?: (table: string, actor: Actor) => Row[];
  getRow?: (table: string, id: string, actor: Actor) => Row | undefined;
  listAuditRows?: (actor: Actor) => AuditRowView[];
  listApprovals?: (resourceType: string, resourceId: string, actor: Actor) => ApprovalView[];
};

type CoreRuntime = Partial<typeof core> & CoreReadExtensions;

const runtime = core as CoreRuntime;

/** True once Session 1's implementation is on the branch. Surfaced in the UI banner. */
export const coreIsImplemented = typeof runtime.can === 'function';

export const can: typeof core.can = runtime.can ?? stubCan;
export const withAudit: typeof core.withAudit = runtime.withAudit ?? stubWithAudit;
export const verifyAuditChain: typeof core.verifyAuditChain =
  runtime.verifyAuditChain ?? stubVerifyAuditChain;
export const requestApproval: typeof core.requestApproval =
  runtime.requestApproval ?? stubRequestApproval;
export const castVote: typeof core.castVote = runtime.castVote ?? stubCastVote;

/**
 * `core.maskRow` is typed against `keyof piiColumns`; the console reads table names
 * out of a spec, which is a plain string. The cast is confined to this one line
 * rather than spread across the routes.
 */
export function maskRow<T extends Record<string, unknown>>(
  table: string,
  row: T,
  actor: Actor,
  opts?: { unmask?: boolean },
): T {
  const impl = runtime.maskRow as
    | ((table: string, row: T, actor: Actor, opts?: { unmask?: boolean }) => T)
    | undefined;
  return (impl ?? stubMaskRow)(table, row, actor, opts);
}

export function listRows(table: string, actor: Actor): Row[] {
  const rows = runtime.listRows ? runtime.listRows(table, actor) : stubListRows(table);
  return rows.map((row) => maskRow(table, row, actor));
}

export function getRow(table: string, id: string, actor: Actor): Row | undefined {
  const row = runtime.getRow ? runtime.getRow(table, id, actor) : stubGetRow(table, id);
  return row ? maskRow(table, row, actor) : undefined;
}

export function listAuditRows(actor: Actor): AuditRowView[] {
  return runtime.listAuditRows ? runtime.listAuditRows(actor) : stubListAuditRows();
}

export function listApprovals(resourceType: string, resourceId: string, actor: Actor): ApprovalView[] {
  if (runtime.listApprovals) return runtime.listApprovals(resourceType, resourceId, actor);
  return stubListApprovals(resourceType, resourceId).map((approval) => ({
    approvalId: approval.approvalId,
    action: approval.action,
    resourceType: approval.resourceType,
    resourceId: approval.resourceId,
    state: approval.state,
    requestedBy: approval.requestedBy,
    requestedAt: approval.requestedAt,
    requiredApprovals: approval.requiredApprovals,
    votes: approval.votes,
  }));
}

/**
 * Whether this actor may vote on this approval. Two conditions: the policy allows
 * the vote action at all, and the four-eyes rule does not bar this particular voter.
 * The second half is core's state machine; the panel only renders the answer.
 */
export function canVoteOn(actor: Actor, approval: ApprovalView): Decision {
  const resource: Resource = { type: approval.resourceType, id: approval.resourceId };
  const decision = can(actor, 'approval.vote', resource);
  if (!decision.allowed) return decision;
  if (stubSelfApprovalBlocked(approval.approvalId, actor.sub)) {
    return { allowed: false, reason: 'You requested this. Four-eyes: someone else must sign off.' };
  }
  return decision;
}
