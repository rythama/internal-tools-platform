import type { Actor, ToolSpec } from '../core-adapter/index';
import { RoleSwitcher } from './role-switcher';

/**
 * Left sidebar: brand, tool navigation, audit, and — pinned to the bottom — who you
 * are and the dev role switcher. The nav lists only what can() permits; tools you
 * cannot see are absent here and explained on the home page.
 */
export function Sidebar({ actor, specs }: { actor: Actor; specs: readonly ToolSpec[] }) {
  return (
    <aside className="sidebar">
      <a className="brand" href="/">
        <span className="brand-mark" aria-hidden="true" />
        Internal Tools
      </a>

      <nav aria-label="Tools">
        <div className="nav-label">Tools</div>
        {specs.map((spec) => (
          <a key={spec.key} href={`/t/${spec.key}`}>
            {spec.title}
          </a>
        ))}
        <div className="nav-label">Platform</div>
        <a href="/audit">Audit chain</a>
      </nav>

      <div className="sidebar-foot">
        <div className="foot-label">Signed in as</div>
        <div className="identity" title={actor.sub}>
          <span className="identity-dot" aria-hidden="true" />
          {actor.email}
        </div>
        <RoleSwitcher actor={actor} />
      </div>
    </aside>
  );
}

/** Kept as an alias so existing imports keep compiling. */
export const Header = Sidebar;
