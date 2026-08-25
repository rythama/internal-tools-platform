/**
 * Dev session issuer (ARCHITECTURE.md §3.2).
 *
 * The cookie carries exactly `{ sub, email, roles[] }` — the claim set an OIDC
 * provider returns — signed with HMAC-SHA256 so the role switcher cannot be used to
 * mint a role by editing the cookie in devtools. Swapping in Okta or Entra replaces
 * this file and nothing else: everything downstream reads the Actor, never the cookie.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Actor, Role } from '../core-adapter/index';

export const SESSION_COOKIE = 'itp_session';

/** Dev-only fallback. A real deployment fails closed instead of defaulting. */
const SECRET = process.env['SESSION_SECRET'] ?? 'dev-only-insecure-session-secret';

export const ALL_ROLES: readonly Role[] = [
  'kyc_reviewer',
  'kyc_approver',
  'refund_agent',
  'refund_approver',
  'flag_admin',
  'auditor',
  'admin',
];

/** Demo personas, so a reviewer can switch identity as well as role. */
export const DEMO_ACTORS: Readonly<Record<Role, Actor>> = {
  kyc_reviewer: { sub: 'u-reviewer', email: 'rina.reviewer@example.com', roles: ['kyc_reviewer'] },
  kyc_approver: { sub: 'u-approver', email: 'adam.approver@example.com', roles: ['kyc_approver'] },
  refund_agent: { sub: 'u-agent', email: 'raj.agent@example.com', roles: ['refund_agent'] },
  refund_approver: { sub: 'u-refapp', email: 'rosa.approver@example.com', roles: ['refund_approver'] },
  flag_admin: { sub: 'u-flags', email: 'fay.flags@example.com', roles: ['flag_admin'] },
  auditor: { sub: 'u-auditor', email: 'ada.auditor@example.com', roles: ['auditor'] },
  admin: { sub: 'u-admin', email: 'alex.admin@example.com', roles: ['admin'] },
};

export const DEFAULT_ROLE: Role = 'kyc_reviewer';

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function encodeSession(actor: Actor): string {
  const payload = Buffer.from(JSON.stringify(actor), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(cookieValue: string | undefined): Actor | undefined {
  if (!cookieValue) return undefined;
  const [payload, signature] = cookieValue.split('.');
  if (!payload || !signature) return undefined;

  const expected = Buffer.from(sign(payload), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return undefined;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return isActor(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isActor(value: unknown): value is Actor {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const claimedRoles = candidate['roles'];
  return (
    typeof candidate['sub'] === 'string' &&
    typeof candidate['email'] === 'string' &&
    Array.isArray(claimedRoles) &&
    claimedRoles.every((role) => typeof role === 'string' && ALL_ROLES.includes(role as Role))
  );
}

export function isRole(value: string | undefined): value is Role {
  return value !== undefined && ALL_ROLES.includes(value as Role);
}

export function actorForRole(role: Role): Actor {
  return DEMO_ACTORS[role];
}

/** Which persona the role switcher should show as selected. Display, not policy. */
export function primaryRole(actor: Actor): Role {
  return actor.roles[0] ?? DEFAULT_ROLE;
}
