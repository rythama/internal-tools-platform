/**
 * Generic action endpoint for spec-declared actions.
 *
 * HTTP only: parse the form, ask `performAction` what happens, put the result in a
 * flash. Every branch it can return — applied, approval requested, denied — is already
 * on the audit chain by the time this handler sees it.
 */
import { NextResponse } from 'next/server';
import { currentActor } from '../../../../../../lib/actor';
import { performAction } from '../../../../../../lib/perform';
import { findSpec } from '../../../../../../lib/registry';

type Context = { params: Promise<{ tool: string; id: string }> };

export async function POST(request: Request, context: Context): Promise<NextResponse> {
  const { tool, id } = await context.params;
  const spec = findSpec(tool);
  if (!spec) return NextResponse.json({ error: 'unknown tool' }, { status: 404 });

  const form = await request.formData();
  const actionKey = form.get('action');
  if (typeof actionKey !== 'string') {
    return NextResponse.json({ error: 'missing action' }, { status: 400 });
  }

  const actor = await currentActor();
  const outcome = performAction({ spec, actor, id, actionKey });

  const detailUrl = new URL(`/t/${spec.key}/${encodeURIComponent(id)}`, request.url);
  if (outcome.status === 'denied') {
    detailUrl.searchParams.set('flash', `Denied: ${outcome.message}`);
    detailUrl.searchParams.set('error', '1');
  } else {
    detailUrl.searchParams.set('flash', outcome.message);
  }
  return NextResponse.redirect(detailUrl, 303);
}
