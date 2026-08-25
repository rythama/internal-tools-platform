import { notFound } from 'next/navigation';
import { ActionBar, ApprovalPanel, Detail } from '@itp/ui';
import { can, canVoteOn, getRow, listApprovals } from '../../../../core-adapter/index';
import { currentActor } from '../../../../lib/actor';
import { canViewTool, findSpec } from '../../../../lib/registry';
import { effectsFor } from '../../../../tools/effects';
import { KYC_SPEC_KEY } from '../../../../tools/kyc-review';
import { UnmaskPanel } from '../../../../components/unmask-panel';

type Props = {
  params: Promise<{ tool: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ToolDetailPage({ params, searchParams }: Props) {
  const { tool, id } = await params;
  const query = await searchParams;
  const spec = findSpec(tool);
  if (!spec) notFound();

  const actor = await currentActor();
  const visibility = canViewTool(actor, spec);
  if (!visibility.allowed) {
    return (
      <>
        <h1>{spec.title}</h1>
        <p className="flash flash-error">Denied: {visibility.reason}</p>
      </>
    );
  }

  const resource = { type: spec.queue.table, id };
  const readDecision = can(actor, 'record.read', resource);
  if (!readDecision.allowed) {
    return (
      <>
        <h1>
          {spec.title} · {id}
        </h1>
        <p className="flash flash-error">Denied: {readDecision.reason}</p>
      </>
    );
  }

  const row = getRow(spec.queue.table, id, actor);
  if (!row) notFound();

  const approvals = listApprovals(spec.queue.table, id, actor);
  const effects = effectsFor(spec.key);
  // Offering the unmask form is a UI decision; whether an unmask happens is core's.
  const mayAskToUnmask = spec.key === KYC_SPEC_KEY && can(actor, 'pii.unmask', resource).allowed;
  const flash = typeof query['flash'] === 'string' ? query['flash'] : undefined;
  const flashError = query['error'] === '1';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            <a href={`/t/${spec.key}`}>{spec.title}</a> · {id}
          </h1>
          <p className="muted">{readDecision.reason}</p>
        </div>
      </div>

      {flash ? <p className={flashError ? 'flash flash-error' : 'flash'}>{flash}</p> : null}

      <div className="detail-grid">
        <div className="panel">
          <Detail spec={spec} row={row} />
          <ActionBar
            spec={spec}
            row={row}
            actor={actor}
            resource={resource}
            can={can}
            endpoint={`/api/t/${spec.key}/${encodeURIComponent(id)}/action`}
            {...(effects ? { requiresApproval: effects.requiresApproval } : {})}
          />
        </div>

        <aside className="panel">
          {mayAskToUnmask ? <UnmaskPanel caseId={id} /> : null}
          <h3>Approvals</h3>
          <ApprovalPanel
            approvals={approvals}
            canVote={(approval) => canVoteOn(actor, approval)}
            endpoint="/api/approvals/vote"
          />
        </aside>
      </div>
    </>
  );
}
