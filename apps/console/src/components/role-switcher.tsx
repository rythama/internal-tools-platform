import type { Actor } from '../core-adapter/index';
import { ALL_ROLES, primaryRole } from '../lib/session';

/**
 * Dev-only identity switcher. It POSTs to the session issuer, which re-mints a
 * signed cookie — the client cannot select a role by editing anything it holds.
 * A real deployment deletes this component and keeps the rest.
 */
export function RoleSwitcher({ actor }: { actor: Actor }) {
  return (
    <form className="role-switcher" method="post" action="/api/session">
      <label className="sr-only" htmlFor="role">
        Act as role
      </label>
      <select id="role" name="role" defaultValue={primaryRole(actor)}>
        {ALL_ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
      <button type="submit">Switch</button>
    </form>
  );
}
