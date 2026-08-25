/** Cast a maker-checker vote. Self-approval is rejected by core, not by this route. */
import { NextResponse } from 'next/server';
import { PolicyDeniedError, castVote } from '../../../../core-adapter/index';
import { currentActor } from '../../../../lib/actor';

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const approvalId = Number(form.get('approvalId'));
  const vote = form.get('vote') === 'reject' ? 'reject' : 'approve';
  const note = form.get('note');

  const referer = request.headers.get('referer');
  const target = new URL(referer ?? '/', request.url);
  target.searchParams.delete('flash');
  target.searchParams.delete('error');

  if (!Number.isInteger(approvalId)) {
    return NextResponse.json({ error: 'bad approvalId' }, { status: 400 });
  }

  const actor = await currentActor();
  try {
    const result = castVote({
      actor,
      approvalId,
      vote,
      ...(typeof note === 'string' && note.length > 0 ? { note } : {}),
    });
    target.searchParams.set('flash', `Vote recorded. Approval #${approvalId} is now ${result.state}.`);
  } catch (error) {
    const reason = error instanceof PolicyDeniedError ? error.decision.reason : 'vote failed';
    target.searchParams.set('flash', `Denied: ${reason}`);
    target.searchParams.set('error', '1');
  }

  return NextResponse.redirect(target, 303);
}
