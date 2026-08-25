import { currentActor } from '../lib/actor';
import { allSpecs, canViewTool, visibleSpecs } from '../lib/registry';

export default async function HomePage() {
  const actor = await currentActor();
  const visible = visibleSpecs(actor);
  const hidden = allSpecs().filter((spec) => !canViewTool(actor, spec).allowed);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tools</h1>
          <p className="muted">
            Hosted on one deployment. What you see here is what can() permits for {actor.email}.
          </p>
        </div>
      </div>

      <ul className="tool-list">
        {visible.map((spec) => (
          <li key={spec.key} className="tool-card">
            <h2>
              <a href={`/t/${spec.key}`}>{spec.title}</a>
            </h2>
            <p className="muted">{spec.description}</p>
          </li>
        ))}
        {visible.length === 0 ? (
          <li className="tool-card">
            <p className="muted">No tools are visible to your roles.</p>
          </li>
        ) : null}
      </ul>

      {hidden.length > 0 ? (
        <>
          <h2>Not visible to you</h2>
          <ul className="tool-list">
            {hidden.map((spec) => (
              <li key={spec.key} className="tool-card">
                <h2>{spec.title}</h2>
                <p className="muted">{canViewTool(actor, spec).reason}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
