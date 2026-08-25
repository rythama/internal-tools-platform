import type { Actor, ToolSpec } from '../core-adapter/index';
import { RoleSwitcher } from './role-switcher';

export function Header({ actor, specs }: { actor: Actor; specs: readonly ToolSpec[] }) {
  return (
    <header className="app-header">
      <a className="brand" href="/">
        ITP CONSOLE
      </a>
      <nav aria-label="Tools">
        {specs.map((spec) => (
          <a key={spec.key} href={`/t/${spec.key}`}>
            {spec.title}
          </a>
        ))}
        <a href="/audit">Audit</a>
      </nav>
      <span className="identity">{actor.email}</span>
      <RoleSwitcher actor={actor} />
    </header>
  );
}
