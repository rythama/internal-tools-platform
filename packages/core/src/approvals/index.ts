/**
 * Maker–checker as one generic primitive (ARCHITECTURE.md §3.6).
 *
 * A tool spec declares "this action needs N approvals, and not from the requester";
 * this module is the only implementation of that sentence in the platform. Every
 * transition — request, vote, denial, apply — is on the audit chain.
 */
import { and, asc, eq } from 'drizzle-orm';
import { now } from '../clock.js';
import { db } from '../db/client.js';
import { approvalVotes, approvals } from '../db/schema.js';
import { appendAudit, auditDenial, type Tx } from '../audit/index.js';
import { can } from '../policy/index.js';
import type { Actor, ApprovalRecord, Resource } from '../types.js';

export const SELF_APPROVAL_REASON =
  'requester may not approve their own request (four-eyes)';

type ApprovalRow = typeof approvals.$inferSelect;

function votesFor(approvalId: number): ApprovalRecord['votes'] {
  return db()
    .select()
    .from(approvalVotes)
    .where(eq(approvalVotes.approvalId, approvalId))
    .orderBy(asc(approvalVotes.id))
    .all()
    .map((vote) => ({
      voterSub: vote.voterSub,
      vote: vote.vote,
      ...(vote.note === null ? {} : { note: vote.note }),
      votedAt: vote.votedAt,
    }));
}

export function toApprovalRecord(row: ApprovalRow): ApprovalRecord {
  return {
    approvalId: row.id,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    state: row.state,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt,
    requiredApprovals: row.requiredApprovals,
    votes: votesFor(row.id),
  };
}

export function findApproval(approvalId: number): ApprovalRow | undefined {
  const [row] = db().select().from(approvals).where(eq(approvals.id, approvalId)).limit(1).all();
  return row;
}

export function approvalsFor(resourceType: string, resourceId: string): ApprovalRow[] {
  return db()
    .select()
    .from(approvals)
    .where(and(eq(approvals.resourceType, resourceType), eq(approvals.resourceId, resourceId)))
    .orderBy(asc(approvals.id))
    .all();
}

/**
 * `action` is the spec's action key ("approve"); `permission` is what can() is asked
 * about ("kyc.approve"). They are separate arguments because only the spec knows the
 * mapping and core does not read specs — recorded on the chain as `<action>.request`
 * so the log distinguishes "asked for" from "did".
 */
export function requestApproval(args: {
  actor: Actor;
  action: string;
  permission: string;
  resource: Resource;
  payload: Record<string, unknown>;
  requiredApprovals: number;
  disallowSelfApproval: boolean;
}): { approvalId: number; state: 'pending' } {
  const decision = can(args.actor, args.permission, args.resource);
  if (!decision.allowed) {
    throw auditDenial({
      actor: args.actor,
      action: `${args.action}.request`,
      resource: args.resource,
      decisionReason: decision.reason,
      diff: { payload: args.payload },
    });
  }

  return db().transaction((tx) => {
    const requestedAt = now();
    const inserted = tx
      .insert(approvals)
      .values({
        resourceType: args.resource.type,
        resourceId: args.resource.id,
        action: args.action,
        payload: args.payload,
        state: 'pending',
        requestedBy: args.actor.sub,
        requestedAt,
        requiredApprovals: args.requiredApprovals,
        disallowSelfApproval: args.disallowSelfApproval,
      })
      .returning({ id: approvals.id })
      .all();

    const approvalId = inserted[0]?.id;
    if (approvalId === undefined) throw new Error('approval insert returned no id');

    appendAudit(tx, {
      actor: args.actor,
      action: `${args.action}.request`,
      resource: args.resource,
      decision: 'allow',
      decisionReason: 'approval requested; the action itself still needs a second signature',
      diff: { approvalId, payload: args.payload },
    });

    return { approvalId, state: 'pending' as const };
  });
}

/**
 * Applying a satisfied approval is idempotent: the transition to 'applied' happens
 * once, and a second call returns the state it already reached. Core owns the state
 * machine, not the domain effect — the tool's mutation runs through withAudit like
 * any other write.
 */
function applyIfSatisfied(tx: Tx, row: ApprovalRow, actor: Actor, approveCount: number): ApprovalRow['state'] {
  if (row.state !== 'pending') return row.state;
  if (approveCount < row.requiredApprovals) return 'pending';

  tx.update(approvals).set({ state: 'applied' }).where(eq(approvals.id, row.id)).run();
  appendAudit(tx, {
    actor,
    action: `${row.action}.applied`,
    resource: { type: row.resourceType, id: row.resourceId },
    decision: 'allow',
    decisionReason: `approval #${row.id} satisfied with ${approveCount} of ${row.requiredApprovals}`,
    diff: { approvalId: row.id, payload: row.payload },
  });
  return 'applied';
}

export function castVote(args: {
  actor: Actor;
  approvalId: number;
  vote: 'approve' | 'reject';
  note?: string;
}): { state: 'pending' | 'approved' | 'rejected' | 'applied' } {
  const row = findApproval(args.approvalId);
  if (!row) throw new Error(`unknown approval ${args.approvalId}`);
  const resource: Resource = { type: row.resourceType, id: row.resourceId };

  const decision = can(args.actor, 'approval.vote', resource);
  if (!decision.allowed) {
    throw auditDenial({
      actor: args.actor,
      action: 'approval.vote',
      resource,
      decisionReason: decision.reason,
      diff: { approvalId: row.id },
    });
  }

  if (row.disallowSelfApproval && row.requestedBy === args.actor.sub) {
    throw auditDenial({
      actor: args.actor,
      action: 'approval.vote',
      resource,
      decisionReason: SELF_APPROVAL_REASON,
      diff: { approvalId: row.id },
    });
  }

  // A decided approval is not a ballot box. Re-voting is a no-op, not an error, so a
  // double-submitted form cannot produce a second signature on the chain.
  if (row.state !== 'pending') {
    return { state: settledState(row.state) };
  }

  const existing = votesFor(row.id);
  if (existing.some((vote) => vote.voterSub === args.actor.sub)) {
    return { state: settledState(row.state) };
  }

  return db().transaction((tx) => {
    tx.insert(approvalVotes)
      .values({
        approvalId: row.id,
        voterSub: args.actor.sub,
        vote: args.vote,
        note: args.note ?? null,
        votedAt: now(),
      })
      .run();

    let state: ApprovalRow['state'] = row.state;
    if (args.vote === 'reject') {
      tx.update(approvals).set({ state: 'rejected' }).where(eq(approvals.id, row.id)).run();
      state = 'rejected';
    }

    appendAudit(tx, {
      actor: args.actor,
      action: 'approval.vote',
      resource,
      decision: 'allow',
      decisionReason: decision.reason,
      diff: { approvalId: row.id, vote: args.vote, ...(args.note ? { note: args.note } : {}) },
    });

    if (args.vote === 'approve') {
      const approveCount = existing.filter((vote) => vote.vote === 'approve').length + 1;
      state = applyIfSatisfied(tx, row, args.actor, approveCount);
    }

    return { state: settledState(state) };
  });
}

/** 'expired' is a storage state the vote API cannot return; collapse it to 'rejected'. */
function settledState(
  state: ApprovalRow['state'],
): 'pending' | 'approved' | 'rejected' | 'applied' {
  return state === 'expired' ? 'rejected' : state;
}
