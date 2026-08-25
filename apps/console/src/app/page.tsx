import { DEMO_EPOCH } from '@itp/core';
import { slaState } from '@itp/ui';
import { currentActor } from '../lib/actor';
import { listRows, verifyAuditChain, type Row } from '../core-adapter/index';
import { allSpecs, canViewTool, visibleSpecs } from '../lib/registry';

/**
 * The console home is an overview, not a directory: each visible tool card carries
 * live numbers from the same authorized, masked read path the tool itself uses —
 * so the landing page is also a small proof that scoping applies everywhere.
 */
export default async function HomePage() {
  const actor = await currentActor();
  const visible = visibleSpecs(actor);
  const hidden = allSpecs().filter((spec) => !canViewTool(actor, spec).allowed);
  const chain = verifyAuditChain();
  const demoNow = new Date(DEMO_EPOCH);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">
            One deployment, many tools. Everything below is what can() permits for {actor.email}.
          </p>
        </div>
      </div>

      <ul className="tool-list">
        {visible.map((spec) => {
          let rows: readonly Row[] = [];
          try {
            rows = listRows(spec.queue.table, actor);
          } catch {
            rows = [];
          }
          const sla = spec.queue.sla;
          const breached = sla
            ? rows.filter((row) => slaState(row[sla.dueField], demoNow) === 'breached').length
            : 0;
          return (
            <li key={spec.key} className="tool-card">
              <a className="tool-card-link" href={`/t/${spec.key}`}>
                <div className="tool-card-head">
                  <h2>{spec.title}</h2>
                  <span className="tool-card-arrow" aria-hidden="true">→</span>
                </div>
                <p className="muted">{spec.description}</p>
                <div className="tool-card-stats">
                  <span><strong>{rows.length}</strong> records</span>
                  {sla ? (
                    <span className={breached > 0 ? 'stat-flag' : ''}>
                      <strong>{breached}</strong> past SLA
                    </span>
                  ) : null}
                </div>
              </a>
            </li>
          );
        })}
        {visible.length === 0 ? (
          <li className="tool-card">
            <p className="muted">No tools are visible to your roles.</p>
          </li>
        ) : null}

        <li className="tool-card platform-card">
          <div className="tool-card-head">
            <h2>Audit chain</h2>
            <span className={chain.ok ? 'pill pill-approved' : 'pill pill-rejected'}>
              {chain.ok ? 'intact' : 'broken'}
            </span>
          </div>
          <p className="muted">
            Every action — including denied attempts — hash-chained in the same transaction as
            the write. Verified on every load of this page.
          </p>
          <div className="tool-card-stats">
            <a href="/audit">View the chain →</a>
          </div>
        </li>
      </ul>

      {hidden.length > 0 ? (
        <section className="hidden-tools">
          <h2>Not visible to you</h2>
          <p className="muted">
            Withheld tools are listed with the policy reason rather than hidden — access here is
            explained, not mysterious.
          </p>
          <ul className="tool-list">
            {hidden.map((spec) => (
              <li key={spec.key} className="tool-card tool-card-denied">
                <div className="tool-card-head">
                  <h2>{spec.title}</h2>
                  <span className="pill">no access</span>
                </div>
                <p className="muted">{canViewTool(actor, spec).reason}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
