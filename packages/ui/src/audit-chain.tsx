export type AuditRowView = {
  seq: number;
  occurredAt: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  decision: 'allow' | 'deny';
  decisionReason?: string;
  diff?: Record<string, unknown>;
  prevHash: string;
  hash: string;
};

export type AuditChainProps = {
  rows: readonly AuditRowView[];
  integrity: { ok: true } | { ok: false; brokenAtSeq: number };
};

/**
 * The chain, newest first, with the integrity banner on top. Denials are rendered
 * as first-class rows — per §3.4 they are the interesting half of the log.
 */
export function AuditChain({ rows, integrity }: AuditChainProps) {
  return (
    <div className="audit">
      <p className={integrity.ok ? 'chain-banner chain-ok' : 'chain-banner chain-broken'}>
        {integrity.ok
          ? `Chain intact — ${rows.length} records verified from genesis.`
          : `Chain broken at seq ${integrity.brokenAtSeq}. Records from that point are not trustworthy.`}
      </p>
      <table className="audit-table">
        <caption className="sr-only">Audit chain, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Seq</th>
            <th scope="col">When</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Resource</th>
            <th scope="col">Decision</th>
            <th scope="col">Hash</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="empty" colSpan={7}>
                No audit records yet.
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={row.seq} className={row.decision === 'deny' ? 'row-deny' : undefined}>
              <td>{row.seq}</td>
              <td>{row.occurredAt}</td>
              <td>{row.actorEmail}</td>
              <td>{row.action}</td>
              <td>
                {row.resourceType}/{row.resourceId}
              </td>
              <td>
                <span className={`badge badge-decision-${row.decision}`}>{row.decision}</span>
                {row.decisionReason ? <span className="muted"> {row.decisionReason}</span> : null}
              </td>
              <td className="hash" title={`prev ${row.prevHash}`}>
                {row.hash.slice(0, 12)}…
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
