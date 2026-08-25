import { notFound } from 'next/navigation';
import { Queue } from '@itp/ui';
import { DEMO_EPOCH } from '@itp/core';
import type { FilterState } from '@itp/ui';
import { listRows } from '../../../core-adapter/index';
import { currentActor } from '../../../lib/actor';
import { canViewTool, findSpec } from '../../../lib/registry';
import { parseSort, readFilters } from '../../../lib/query';

type Props = {
  params: Promise<{ tool: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ToolQueuePage({ params, searchParams }: Props) {
  const { tool } = await params;
  const query = await searchParams;
  const spec = findSpec(tool);
  if (!spec) notFound();

  const actor = await currentActor();
  const decision = canViewTool(actor, spec);
  if (!decision.allowed) {
    return (
      <>
        <h1>{spec.title}</h1>
        <p className="flash flash-error">Denied: {decision.reason}</p>
      </>
    );
  }

  const filters: FilterState = readFilters(spec, query);
  const sort = parseSort(query['sort']) ?? spec.queue.defaultSort;
  const rows = listRows(spec.queue.table, actor);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{spec.title}</h1>
          <p className="muted">{spec.description}</p>
        </div>
      </div>
      {/* SLA is judged against the package clock, not the wall clock: the seed is
          pinned to a demo epoch (audit hashes depend on it), so wall-clock "now"
          would mark every seeded row breached and the badge would carry no signal. */}
      <Queue spec={spec} rows={rows} filters={filters} {...(sort ? { sort } : {})} basePath={`/t/${spec.key}`} now={new Date(DEMO_EPOCH)} />
    </>
  );
}
