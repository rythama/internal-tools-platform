/**
 * Identity assertions for the external API boundary (ARCHITECTURE.md §3.8).
 *
 * A rented UI (Retool, Appsmith) reaches the data layer through a service account,
 * which is exactly how an audit trail degenerates into a log: every row names the
 * machine. The fix at this boundary is a short-lived, HMAC-signed assertion of the
 * *human's* identity, minted by the session issuer and verified here independently
 * of whatever the calling UI claims.
 *
 * Deliberately not a JWT and not a JWT library: HMAC-SHA256 over canonical JSON,
 * verification legible in this one file. The algorithm identifier is bound into the
 * signed material, so an "alg: none"-style downgrade is a signature mismatch, not a
 * parsing decision.
 *
 * This is half of the identity-binding story — the API boundary. The database
 * boundary (Postgres RLS keyed off a per-request session variable) is out of scope
 * on SQLite and is NOT claimed here. See §3.8.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { auditDenial } from '../audit/index';
import { canonicalJSON } from '../audit/hash';
import { now } from '../clock';
import { rolesSnapshot } from '../policy/index';
import { ROLES } from '../policy/rules';
import type { Actor, PolicyDeniedError, Role } from '../types';

export const ASSERTION_SECRET_ENV = 'ITP_ASSERTION_SECRET';
export const DEFAULT_ASSERTION_TTL_SECONDS = 60;
/** Bound into the signed material; any other prefix is refused before parsing. */
export const ASSERTION_ALG = 'itp-hs256';

/**
 * The machine identity a rented UI would connect with. Over-privileged on purpose —
 * service accounts invariably are — so the demo shows the real failure mode: the
 * query succeeds, and the audit chain names a machine instead of a person.
 */
export const SERVICE_ACTOR: Actor = {
  sub: 'svc_retool',
  email: 'svc_retool@service.internal',
  roles: ['admin'],
};

type AssertionClaims = {
  sub: string;
  email: string;
  roles: readonly string[];
  iat: number;
  exp: number;
};

function signingSecret(): string {
  const secret = process.env[ASSERTION_SECRET_ENV];
  if (secret === undefined || secret.length === 0) {
    // Fail closed. A defaulted signing key is a published signing key — the exact
    // finding docs/PR1-REVIEW.md records against the session secret.
    throw new Error(`${ASSERTION_SECRET_ENV} is required: refusing to sign or verify assertions without it`);
  }
  return secret;
}

function nowSeconds(): number {
  return Math.floor(Date.parse(now()) / 1000);
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`${ASSERTION_ALG}.${payload}`).digest('base64url');
}

/**
 * Mints a signed assertion of the actor's identity: `{ sub, email, roles, iat, exp }`,
 * TTL 60 seconds by default. Only the session issuer should call this — the UI passes
 * the token through and can neither mint nor extend one.
 */
export function mintAssertion(actor: Actor, opts?: { ttlSeconds?: number }): string {
  const secret = signingSecret();
  const iat = nowSeconds();
  const claims: AssertionClaims = {
    sub: actor.sub,
    email: actor.email,
    roles: rolesSnapshot(actor),
    iat,
    exp: iat + (opts?.ttlSeconds ?? DEFAULT_ASSERTION_TTL_SECONDS),
  };
  const payload = Buffer.from(canonicalJSON(claims), 'utf8').toString('base64url');
  return `${ASSERTION_ALG}.${payload}.${sign(payload, secret)}`;
}

/**
 * Best-effort identity out of an UNVERIFIED payload, for the deny row only. A refused
 * assertion is an attempted access, and the chain should record who the token claimed
 * to be — flagged as unverified, never trusted for anything else.
 */
function claimedIdentity(payloadPart: string | undefined): Actor {
  const unknown: Actor = { sub: 'unverified', email: 'unverified', roles: [] };
  if (!payloadPart) return unknown;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return unknown;
    const candidate = parsed as Record<string, unknown>;
    return {
      sub: typeof candidate['sub'] === 'string' ? candidate['sub'] : 'unverified',
      email: typeof candidate['email'] === 'string' ? candidate['email'] : 'unverified',
      roles: [],
    };
  } catch {
    return unknown;
  }
}

function refuse(reason: string, claimed: Actor): PolicyDeniedError {
  return auditDenial({
    actor: claimed,
    action: 'assertion.verify',
    resource: { type: 'ext_api', id: '*' },
    decisionReason: reason,
  });
}

function isKnownRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

function parseClaims(payloadPart: string): AssertionClaims | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const candidate = parsed as Record<string, unknown>;
  const { sub, email, roles, iat, exp } = {
    sub: candidate['sub'],
    email: candidate['email'],
    roles: candidate['roles'],
    iat: candidate['iat'],
    exp: candidate['exp'],
  };
  if (typeof sub !== 'string' || sub.length === 0) return undefined;
  if (typeof email !== 'string' || email.length === 0) return undefined;
  if (!Array.isArray(roles)) return undefined;
  if (typeof iat !== 'number' || typeof exp !== 'number') return undefined;
  return { sub, email, roles, iat, exp };
}

/**
 * Verifies an assertion and returns the Actor it names, or throws PolicyDeniedError.
 * Every refusal — expired, tampered, alg-confused, unknown role, malformed — is
 * audited with `decision: 'deny'` before the throw: a rejected assertion is an
 * attempted access, which is exactly what belongs on the chain.
 */
export function verifyAssertion(token: string): Actor {
  const secret = signingSecret();
  const [alg, payloadPart, signaturePart, ...rest] = token.split('.');
  const claimed = claimedIdentity(payloadPart);

  if (!alg || !payloadPart || !signaturePart || rest.length > 0) {
    throw refuse('assertion is not a three-part token', claimed);
  }
  if (alg !== ASSERTION_ALG) {
    throw refuse(`assertion algorithm ${JSON.stringify(alg)} is not ${ASSERTION_ALG}`, claimed);
  }

  const expected = Buffer.from(sign(payloadPart, secret), 'utf8');
  const provided = Buffer.from(signaturePart, 'utf8');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw refuse('assertion signature does not verify', claimed);
  }

  const claims = parseClaims(payloadPart);
  if (!claims) throw refuse('assertion payload is malformed', claimed);
  const verifiedRoles: Role[] = [];
  for (const role of claims.roles) {
    if (!isKnownRole(role)) {
      throw refuse('assertion claims a role this deployment does not know', claimed);
    }
    verifiedRoles.push(role);
  }
  if (claims.exp <= nowSeconds()) {
    throw refuse('assertion is expired', { sub: claims.sub, email: claims.email, roles: [] });
  }

  return { sub: claims.sub, email: claims.email, roles: verifiedRoles };
}
