/** Server-side accessor for the current Actor. Nothing else may read the cookie. */
import { cookies } from 'next/headers';
import type { Actor } from '../core-adapter/index';
import { DEFAULT_ROLE, SESSION_COOKIE, actorForRole, decodeSession } from './session';

export async function currentActor(): Promise<Actor> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value) ?? actorForRole(DEFAULT_ROLE);
}
