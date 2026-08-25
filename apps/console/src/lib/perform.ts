/**
 * What happens when an operator triggers an action, independent of HTTP.
 *
 * The route handlers own cookies, form parsing and redirects; the decisions live here,
 * so the interesting paths — a state machine refusal, a risk-triggered approval hop, a
 * checker applying an approved action — are reachable from a test without a request.
 */
import { resolveActions } from '@itp/ui';
import type { Actor, Row, ToolSpec } from '../core-adapter/index';
import {
  PolicyDeniedError,
  can,
  castVote,
  getApproval,
  getRow,
  policyAttrs,
  recordDenial,
  requestApproval,
  revealRow,
  updateRow,
} from '../core-adapter/index';
import { specForTable } from './registry';
import { effectsFor } from '../tools/effects';
import { withUnmaskGrant } from './unmask-grant';

export type ActionOutcome =
  | { status: 'applied'; message: string; row: Row }
  | { status: 'requested'; message: string; approvalId: number }
  | { status: 'denied'; message: string };

export function performAction(args: {
  spec: ToolSpec;
  actor: Actor;
  id: string;
  actionKey: string;
}): ActionOutcome {
  const { spec, actor, id } = args;
  const declared = spec.actions.find((candidate) => candidate.key === args.actionKey);
  if (!declared) return { status: 'denied', message: 'unknown action' };

  const row = getRow(spec.queue.table, id, actor);
  if (!row) return { status: 'denied', message: 'unknown record' };

  // Attribute-conditional rules (e.g. the refund self-service limit) threshold on
  // row attributes; a resource without them makes those rules fail closed and deny
  // rows they were written to allow.
  const resource = { type: spec.queue.table, id, attrs: policyAttrs(row) };

  const effects = effectsFor(spec.key);

  // Re-resolved server-side: the button an operator pressed is a hint, not an authority.
  const resolved = resolveActions({
    spec,
    row,
    actor,
    resource,
    can,
    ...(effects ? { requiresApproval: effects.requiresApproval } : {}),
  }).allowed.find((candidate) => candidate.key === declared.key);

  try {
    if (!resolved) {
      // A denial that leaves no trace is the failure mode §3.4 exists to prevent.
      const decision = can(actor, declared.permission, resource);
      throw recordDenial({
        actor,
        action: declared.permission,
        resource,
        decisionReason: decision.allowed ? 'action not available on this record' : decision.reason,
        diff: { action: declared.key },
      });
    }

    if (resolved.mode === 'request') {
      const approval = requestApproval({
        actor,
        action: declared.key,
        permission: declared.permission,
        resource,
        payload: { action: declared.key },
        requiredApprovals: declared.approval?.requiredApprovals ?? 1,
        disallowSelfApproval: declared.approval?.disallowSelfApproval ?? true,
      });
      return {
        status: 'requested',
        approvalId: approval.approvalId,
        message: `Approval #${approval.approvalId} requested for “${declared.label}”: it needs a second signature.`,
      };
    }

    const patch = effects?.patchFor(declared.key, row, actor);
    if (patch && !patch.ok) {
      throw recordDenial({
        actor,
        action: declared.permission,
        resource,
        decisionReason: patch.reason,
        diff: { action: declared.key },
      });
    }

    const updated = updateRow({
      table: spec.queue.table,
      id,
      patch: patch?.patch ?? {},
      actor,
      permission: declared.permission,
      context: { action: declared.key },
    });
    return {
      status: 'applied',
      message: `“${declared.label}” recorded on the audit chain.`,
      row: (updated ?? row) as Row,
    };
  } catch (error) {
    return { status: 'denied', message: describe(error) };
  }
}

export type VoteOutcome = { status: 'ok'; message: string } | { status: 'denied'; message: string };

export function performVote(args: {
  actor: Actor;
  approvalId: number;
  vote: 'approve' | 'reject';
  note?: string;
}): VoteOutcome {
  try {
    const result = castVote({
      actor: args.actor,
      approvalId: args.approvalId,
      vote: args.vote,
      ...(args.note === undefined ? {} : { note: args.note }),
    });
    const applied =
      result.state === 'applied' ? applyApproved(args.approvalId, args.actor) : '';
    return {
      status: 'ok',
      message: `Vote recorded. Approval #${args.approvalId} is now ${result.state}.${applied}`,
    };
  } catch (error) {
    return { status: 'denied', message: describe(error) };
  }
}

/**
 * Applies the domain effect of an approval core has just marked satisfied, under the
 * checker's own permission. A refusal here is audited and reported rather than thrown:
 * the vote is already on the chain and must not be undone by it.
 */
function applyApproved(approvalId: number, actor: Actor): string {
  const approval = getApproval(approvalId, actor);
  if (!approval) return '';

  const spec = specForTable(approval.resourceType);
  const effects = spec ? effectsFor(spec.key) : undefined;
  if (!effects) return '';

  const row = getRow(approval.resourceType, approval.resourceId, actor);
  if (!row) return '';

  const patch = effects.patchFor(approval.action, row, actor);
  if (!patch.ok) {
    recordDenial({
      actor,
      action: effects.applyPermission,
      resource: { type: approval.resourceType, id: approval.resourceId },
      decisionReason: patch.reason,
      diff: { approvalId, action: approval.action },
    });
    return ` The case was not transitioned: ${patch.reason}.`;
  }

  updateRow({
    table: approval.resourceType,
    id: approval.resourceId,
    patch: patch.patch,
    actor,
    permission: effects.applyPermission,
    context: { approvalId, action: approval.action },
  });
  return ` “${approval.action}” applied to ${approval.resourceId}.`;
}

export type UnmaskOutcome =
  | { status: 'revealed'; fields: Record<string, string> }
  | { status: 'denied'; message: string };

/**
 * Unmask-with-reason. The reason gates the grant and is carried into the audit row core
 * writes, so "who read this customer's tax id, when, and why they said they had to" is
 * one query. A reason too short to mean anything is the same as none, and refusing it is
 * a decision about access — so it is a denial on the chain, not a form validation
 * message the audit log never hears about.
 */
export function performUnmask(args: {
  actor: Actor;
  table: string;
  id: string;
  fields: readonly string[];
  reason: string;
  minReasonLength: number;
}): UnmaskOutcome {
  const resource = { type: args.table, id: args.id };
  const reason = args.reason.trim();

  if (reason.length < args.minReasonLength) {
    const denial = recordDenial({
      actor: args.actor,
      action: 'pii.unmask',
      resource,
      decisionReason: `unmask refused: a reason of at least ${args.minReasonLength} characters is required`,
      diff: { fields: [...args.fields], reason },
    });
    return { status: 'denied', message: denial.decision.reason };
  }

  try {
    const revealed = revealRow(
      args.table,
      args.id,
      withUnmaskGrant(args.actor, args.table),
      reason,
    );
    if (!revealed) return { status: 'denied', message: 'Record not found, or not readable by you.' };

    const fields: Record<string, string> = {};
    for (const field of args.fields) {
      const value = revealed[field];
      if (typeof value === 'string') fields[field] = value;
    }
    return { status: 'revealed', fields };
  } catch (error) {
    // core audited the denial before throwing; the caller only has to explain it.
    return { status: 'denied', message: describe(error) };
  }
}

function describe(error: unknown): string {
  if (error instanceof PolicyDeniedError) return error.decision.reason;
  return error instanceof Error ? error.message : 'action failed';
}
