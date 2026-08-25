/**
 * Issues the time-boxed unmask grant that `maskRow(…, { unmask: true })` requires.
 *
 * Where a grant comes from is a deployment question. In this console it is break-glass:
 * a reviewer who states a reason gets a grant scoped to one resource type and valid for
 * the length of that one request, and the audit record — actor, case, timestamp,
 * reason — is the control. What matters structurally is where a grant may NOT come
 * from: the session cookie. `session.ts` drops any `unmaskGrants` a payload asserts, so
 * this function is the only way an Actor in this app acquires one, and it cannot be
 * reached without going through the flow that records why.
 *
 * Swapping break-glass for a real access-request service replaces this file.
 */
import type { Actor } from '../core-adapter/index';

/** Long enough for core to read the row, short enough to be useless if it leaked. */
const GRANT_TTL_MS = 60_000;

export function withUnmaskGrant(actor: Actor, resourceType: string, at: Date = new Date()): Actor {
  return {
    ...actor,
    unmaskGrants: [
      { resourceType, expiresAt: new Date(at.getTime() + GRANT_TTL_MS).toISOString() },
    ],
  };
}
