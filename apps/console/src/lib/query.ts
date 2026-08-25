/** URL query ↔ queue view state. Every queue view is a shareable URL. */
import type { ToolSpec } from '../core-adapter/index';
import type { FilterState } from '@itp/ui';

type Query = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Only fields the spec declares as filters are honoured — the URL is untrusted. */
export function readFilters(spec: ToolSpec, query: Query): FilterState {
  const filters: Record<string, string> = {};
  for (const filter of spec.queue.filters ?? []) {
    const value = single(query[filter.field]);
    if (value && filter.options.includes(value)) filters[filter.field] = value;
  }
  return filters;
}

export function parseSort(
  value: string | string[] | undefined,
): { field: string; dir: 'asc' | 'desc' } | undefined {
  const raw = single(value);
  if (!raw) return undefined;
  const [field, dir] = raw.split(':');
  if (!field) return undefined;
  return { field, dir: dir === 'desc' ? 'desc' : 'asc' };
}
