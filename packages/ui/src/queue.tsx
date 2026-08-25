import type { ToolSpec } from '@itp/core';
import { applyFilters, cellText, slaLabel, slaState, sortRows, type FilterState, type Row } from './logic';

export type QueueProps = {
  spec: ToolSpec;
  rows: readonly Row[];
  /** Current filter selection, normally read from the URL query string. */
  filters?: FilterState;
  sort?: { field: string; dir: 'asc' | 'desc' };
  /** Row links resolve to `${basePath}/${id}`. */
  basePath: string;
  idField?: string;
  now?: Date;
};

/**
 * Spec-driven queue. Filtering and sorting are plain GET form submissions so the
 * table works without client JS and every view is a shareable URL — an operator
 * pasting a filtered queue into a ticket is a real workflow.
 */
export function Queue(props: QueueProps) {
  const { spec, basePath } = props;
  const filters = props.filters ?? {};
  const idField = props.idField ?? 'id';
  const sort = props.sort ?? spec.queue.defaultSort;
  const now = props.now ?? new Date();

  const rows = sortRows(applyFilters(props.rows, filters), sort);
  const sla = spec.queue.sla;

  return (
    <section className="queue">
      {spec.queue.filters && spec.queue.filters.length > 0 ? (
        <form className="queue-filters" method="get" action={basePath}>
          {spec.queue.filters.map((filter) => (
            <label key={filter.field} className="field">
              <span>{filter.label}</span>
              <select name={filter.field} defaultValue={filters[filter.field] ?? ''}>
                <option value="">All</option>
                {filter.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {sort ? <input type="hidden" name="sort" value={`${sort.field}:${sort.dir}`} /> : null}
          <button type="submit">Apply</button>
          <a className="btn-link" href={basePath}>
            Reset
          </a>
        </form>
      ) : null}

      <table className="queue-table">
        <caption className="sr-only">{spec.title} queue</caption>
        <thead>
          <tr>
            {spec.queue.columns.map((column) => {
              const dir = sort?.field === column.field && sort.dir === 'asc' ? 'desc' : 'asc';
              const query = new URLSearchParams({ ...filters, sort: `${column.field}:${dir}` });
              return (
                <th key={column.field} scope="col" style={column.width ? { width: column.width } : undefined}>
                  <a href={`${basePath}?${query.toString()}`}>
                    {column.label}
                    {sort?.field === column.field ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </a>
                </th>
              );
            })}
            {sla ? <th scope="col">SLA</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="empty" colSpan={spec.queue.columns.length + (sla ? 1 : 0)}>
                No rows match this view.
              </td>
            </tr>
          ) : null}
          {rows.map((row) => {
            const id = cellText(row[idField]);
            return (
              <tr key={id}>
                {spec.queue.columns.map((column, index) => (
                  <td key={column.field}>
                    {index === 0 ? (
                      <a href={`${basePath}/${encodeURIComponent(id)}`}>{cellText(row[column.field])}</a>
                    ) : isEnumField(column.field) ? (
                      /* Presentation only: state-like values read as chips, not prose. */
                      <span className={`pill pill-${cellText(row[column.field])}`}>
                        {cellText(row[column.field])}
                      </span>
                    ) : (
                      cellText(row[column.field])
                    )}
                  </td>
                ))}
                {sla ? (
                  <td>
                    <SlaBadge value={row[sla.dueField]} now={now} />
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="queue-count">
        {rows.length} of {props.rows.length} rows
      </p>
    </section>
  );
}

/** Fields whose values are a closed vocabulary; styled as chips. */
function isEnumField(field: string): boolean {
  return field === 'status' || field === 'environment' || field === 'state';
}

export function SlaBadge({ value, now }: { value: unknown; now: Date }) {
  const state = slaState(value, now);
  return <span className={`badge badge-sla-${state}`}>{slaLabel(state)}</span>;
}
