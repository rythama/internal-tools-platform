import { AuditChain } from '@itp/ui';
import { can, listAuditRows, verifyAuditChain } from '../../core-adapter/index';
import { currentActor } from '../../lib/actor';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const actor = await currentActor();
  const decision = can(actor, 'audit.view', { type: 'audit_log', id: '*' });

  if (!decision.allowed) {
    return (
      <>
        <h1>Audit</h1>
        <p className="flash flash-error">Denied: {decision.reason}</p>
      </>
    );
  }

  const rows = [...listAuditRows(actor)].sort((a, b) => b.seq - a.seq);
  const integrity = verifyAuditChain();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit chain</h1>
          <p className="muted">
            Newest first. Denied attempts are recorded alongside allowed ones — the chain is
            the record of what was tried, not only what succeeded.
          </p>
        </div>
      </div>
      <AuditChain rows={rows} integrity={integrity} />
    </>
  );
}
