/**
 * Generic action endpoint for spec-declared actions.
 *
 * The shell decides *whether* an action may run and *how* it is recorded; it never
 * decides what the action does to a domain table — that belongs to the tool. So the
 * mutation here is empty: the audit row and the approval request are the whole of the
 * platform's contribution, and Session 3 supplies the domain effect.
 */
import { NextResponse } from 'next/server';
import { resolveActions } from '@itp/ui';
import {
  PolicyDeniedError,
  getRow,
  requestApproval,
  withAudit,
} from '../../../../../../core-adapter/index';
import { currentActor } from '../../../../../../lib/actor';
import { findSpec } from '../../../../../../lib/registry';
import { can } from '../../../../../../core-adapter/index';

type Context = { params: Promise<{ tool: string; id: string }> };

export async function POST(request: Request, context: Context): Promise<NextResponse> {
  const { tool, id } = await context.params;
  const spec = findSpec(tool);
  if (!spec) return NextResponse.json({ error: 'unknown tool' }, { status: 404 });

  const form = await request.formData();
  const actionKey = form.get('action');
  const declared = spec.actions.find((candidate) => candidate.key === actionKey);
  if (!declared) return NextResponse.json({ error: 'unknown action' }, { status: 400 });

  const actor = await currentActor();
  const resource = { type: spec.queue.table, id };
  const row = getRow(spec.queue.table, id, actor);
  if (!row) return NextResponse.json({ error: 'unknown record' }, { status: 404 });

  const detailUrl = new URL(`/t/${spec.key}/${encodeURIComponent(id)}`, request.url);

  // Re-resolve server-side: the button the browser posted is a hint, not an authority.
  const resolved = resolveActions({ spec, row, actor, resource, can }).allowed.find(
    (candidate) => candidate.key === declared.key,
  );

  try {
    if (!resolved) {
      // Audit the refusal, then report it. A denial that leaves no trace is the
      // failure mode §3.4 exists to prevent.
      withAudit({
        actor,
        action: declared.permission,
        resource,
        diff: { action: declared.key },
        mutate: () => undefined,
      });
      throw new PolicyDeniedError(can(actor, declared.permission, resource));
    }

    if (resolved.mode === 'request') {
      const approval = requestApproval({
        actor,
        action: declared.key,
        // Contract now takes the permission explicitly: core authorizes the request
        // itself rather than the console vouching that it already did.
        permission: declared.permission,
        resource,
        payload: { action: declared.key },
        requiredApprovals: declared.approval?.requiredApprovals ?? 1,
        disallowSelfApproval: declared.approval?.disallowSelfApproval ?? true,
      });
      detailUrl.searchParams.set(
        'flash',
        `Approval #${approval.approvalId} requested for “${declared.label}”. It needs a second signature.`,
      );
    } else {
      withAudit({
        actor,
        action: declared.permission,
        resource,
        diff: { action: declared.key },
        mutate: () => undefined,
      });
      detailUrl.searchParams.set('flash', `“${declared.label}” recorded on the audit chain.`);
    }
  } catch (error) {
    const reason = error instanceof PolicyDeniedError ? error.decision.reason : 'action failed';
    detailUrl.searchParams.set('flash', `Denied: ${reason}`);
    detailUrl.searchParams.set('error', '1');
  }

  return NextResponse.redirect(detailUrl, 303);
}
