/**
 * Dev session issuer (ARCHITECTURE.md §3.2).
 *
 * The cookie carries exactly `{ sub, email, roles[] }` — the claim set an OIDC
 * provider returns — signed with HMAC-SHA256 so the role switcher cannot be used to
 * mint a role by editing the cookie in devtools. Swapping in Okta or Entra replaces
 * this file and nothing else: everything downstream reads the Actor, never the cookie.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Actor, Role } from '../core-adapter/index';

export const SESSION_COOKIE = 'itp_session';

/**
 * A per-process random key, used only when SESSION_SECRET is unset outside production.
 * The previous hardcoded default was a published constant: anyone could compute a
 * valid signature for `{ roles: ['admin'] }` and be an admin. Random-per-process keeps
 * `npm run dev` working (cookies simply do not survive a restart) while making the
 * signing key unknowable, and production refuses to start without a real secret.
 */
let ephemeralSecret: string | undefined;

function sessionSecret(): string {
  const configured = process.env['SESSION_SECRET'];
  if (configured !== undefined && configured.length > 0) return configured;
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('SESSION_SECRET is required: refusing to sign sessions with a default key');
  }
  ephemeralSecret ??= randomBytes(32).toString('base64url');
  return ephemeralSecret;
}

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
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
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
    return toActor(parsed);
  } catch {
    return undefined;
  }
}

/**
 * Rebuilds the Actor from the claims this issuer is willing to honour, rather than
 * returning the decoded object.
 *
 * Passing the payload through wholesale made every Actor field a claim: a cookie
 * could carry `unmaskGrants` and mint itself a live PII grant, because `hasUnmaskGrant`
 * reads them off the Actor. Grants are authority, not identity — they are issued
 * per-request by the unmask flow (which records a reason), never asserted by the
 * client. Anything not listed here is dropped, signature or no signature.
 */
function toActor(value: unknown): Actor | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const sub = candidate['sub'];
  const email = candidate['email'];
  const claimedRoles = candidate['roles'];

  if (typeof sub !== 'string' || sub.length === 0) return undefined;
  if (typeof email !== 'string' || email.length === 0) return undefined;
  if (!Array.isArray(claimedRoles) || claimedRoles.length === 0) return undefined;
  if (!claimedRoles.every((role): role is Role => isRole(typeof role === 'string' ? role : undefined))) {
    return undefined;
  }

  return { sub, email, roles: [...claimedRoles] };
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
