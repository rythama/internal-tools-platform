/**
 * Cast a maker-checker vote.
 *
 * HTTP only. Self-approval, duplicate votes and the vote state machine are core's
 * refusals; applying the approved action once the last signature lands is
 * `performVote`'s.
 */
import { NextResponse } from 'next/server';
import { currentActor } from '../../../../lib/actor';
import { performVote } from '../../../../lib/perform';

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const approvalId = Number(form.get('approvalId'));
  const vote = form.get('vote') === 'reject' ? 'reject' : 'approve';
  const note = form.get('note');

  if (!Number.isInteger(approvalId)) {
    return NextResponse.json({ error: 'bad approvalId' }, { status: 400 });
  }

  const actor = await currentActor();
  const outcome = performVote({
    actor,
    approvalId,
    vote,
    ...(typeof note === 'string' && note.length > 0 ? { note } : {}),
  });

  const target = new URL(request.headers.get('referer') ?? '/', request.url);
  target.searchParams.delete('flash');
  target.searchParams.delete('error');
  if (outcome.status === 'denied') {
    target.searchParams.set('flash', `Denied: ${outcome.message}`);
    target.searchParams.set('error', '1');
  } else {
    target.searchParams.set('flash', outcome.message);
  }
  return NextResponse.redirect(target, 303);
}
