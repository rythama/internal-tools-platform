import { notFound } from 'next/navigation';
import { Queue } from '@itp/ui';
import type { FilterState } from '@itp/ui';
import { listRows } from '../../../core-adapter/index';
import { currentActor } from '../../../lib/actor';
import { canViewTool, findSpec } from '../../../lib/registry';
import { StubBanner } from '../../../components/stub-banner';
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
      <StubBanner />
      <div className="page-head">
        <div>
          <h1>{spec.title}</h1>
          <p className="muted">{spec.description}</p>
        </div>
      </div>
      <Queue spec={spec} rows={rows} filters={filters} {...(sort ? { sort } : {})} basePath={`/t/${spec.key}`} />
    </>
  );
}
