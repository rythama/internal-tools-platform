import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFixedClock, useSystemClock } from '../clock';
import { raw, useInMemoryDatabaseForTests } from '../db/client';
import { canonicalJSON } from '../audit/hash';
import { PolicyDeniedError, type Actor } from '../types';
import {
  ASSERTION_ALG,
  ASSERTION_SECRET_ENV,
  DEFAULT_ASSERTION_TTL_SECONDS,
  SERVICE_ACTOR,
  mintAssertion,
  verifyAssertion,
} from './index';

const REVIEWER: Actor = { sub: 'u-reviewer', email: 'rina@example.com', roles: ['kyc_reviewer'] };
const SECRET = 'test-assertion-secret';
const T0 = '2025-03-01T00:00:00.000Z';

function denyRows(): Array<{ action: string; decision: string; actor_email: string }> {
  return raw()
    .prepare("select action, decision, actor_email from audit_log where decision = 'deny'")
    .all() as Array<{ action: string; decision: string; actor_email: string }>;
}

/** Builds a token the way the issuer does, so tests can sign arbitrary claims. */
function craftToken(claims: Record<string, unknown>, secret: string, alg = ASSERTION_ALG): string {
  const payload = Buffer.from(canonicalJSON(claims), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(`${alg}.${payload}`).digest('base64url');
  return `${alg}.${payload}.${signature}`;
}

beforeEach(() => {
  useInMemoryDatabaseForTests();
  useFixedClock(T0, 0);
  vi.stubEnv(ASSERTION_SECRET_ENV, SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  useSystemClock();
});

describe('mintAssertion', () => {
  it('refuses to mint when the signing secret is unset (fail closed)', () => {
    vi.stubEnv(ASSERTION_SECRET_ENV, '');
    expect(() => mintAssertion(REVIEWER)).toThrow(/ITP_ASSERTION_SECRET/);
  });

  it('round-trips: a minted assertion verifies back to the same identity', () => {
    const actor = verifyAssertion(mintAssertion(REVIEWER));
    expect(actor).toEqual({ sub: 'u-reviewer', email: 'rina@example.com', roles: ['kyc_reviewer'] });
  });

  it('defaults the TTL to 60 seconds', () => {
    expect(DEFAULT_ASSERTION_TTL_SECONDS).toBe(60);
    const token = mintAssertion(REVIEWER);
    const payload = token.split('.')[1] ?? '';
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      iat: number;
      exp: number;
    };
    expect(claims.exp - claims.iat).toBe(60);
  });
});

describe('verifyAssertion', () => {
  it('refuses when the verification secret is unset (fail closed)', () => {
    const token = mintAssertion(REVIEWER);
    vi.stubEnv(ASSERTION_SECRET_ENV, '');
    expect(() => verifyAssertion(token)).toThrow(/ITP_ASSERTION_SECRET/);
  });

  it('refuses an expired assertion and audits the refusal', () => {
    const token = mintAssertion(REVIEWER, { ttlSeconds: 60 });
    useFixedClock('2025-03-01T00:02:00.000Z', 0);

    expect(() => verifyAssertion(token)).toThrow(PolicyDeniedError);
    expect(denyRows()).toEqual([
      { action: 'assertion.verify', decision: 'deny', actor_email: 'rina@example.com' },
    ]);
  });

  it('refuses a tampered payload (role added) and audits the refusal', () => {
    const token = mintAssertion(REVIEWER);
    const [alg, , signature] = token.split('.');
    const escalated = Buffer.from(
      canonicalJSON({
        sub: 'u-reviewer',
        email: 'rina@example.com',
        roles: ['kyc_reviewer', 'admin'],
        iat: Math.floor(Date.parse(T0) / 1000),
        exp: Math.floor(Date.parse(T0) / 1000) + 60,
      }),
      'utf8',
    ).toString('base64url');

    expect(() => verifyAssertion(`${alg}.${escalated}.${signature}`)).toThrow(PolicyDeniedError);
    expect(denyRows()).toHaveLength(1);
    expect(denyRows()[0]?.action).toBe('assertion.verify');
  });

  it('refuses an assertion minted with a different secret', () => {
    vi.stubEnv(ASSERTION_SECRET_ENV, 'some-other-secret');
    const token = mintAssertion(REVIEWER);
    vi.stubEnv(ASSERTION_SECRET_ENV, SECRET);

    expect(() => verifyAssertion(token)).toThrow(PolicyDeniedError);
    expect(denyRows()).toHaveLength(1);
  });

  it('refuses an alg-confused token even when its signature is valid for that alg', () => {
    const nowSec = Math.floor(Date.parse(T0) / 1000);
    const claims = { ...REVIEWER, iat: nowSec, exp: nowSec + 60 };
    const confused = craftToken(claims, SECRET, 'none');

    expect(() => verifyAssertion(confused)).toThrow(PolicyDeniedError);
    expect(denyRows()).toHaveLength(1);
  });

  it('refuses a correctly-signed assertion claiming a role this deployment does not know', () => {
    const nowSec = Math.floor(Date.parse(T0) / 1000);
    const escalated = craftToken(
      { sub: 'u-x', email: 'x@example.com', roles: ['superuser'], iat: nowSec, exp: nowSec + 60 },
      SECRET,
    );

    expect(() => verifyAssertion(escalated)).toThrow(PolicyDeniedError);
    expect(denyRows()).toHaveLength(1);
  });

  it('refuses garbage tokens and audits the attempt', () => {
    expect(() => verifyAssertion('not-a-token')).toThrow(PolicyDeniedError);
    expect(denyRows()).toHaveLength(1);
  });
});

describe('SERVICE_ACTOR', () => {
  it('is the machine identity the contrast demo audits against', () => {
    expect(SERVICE_ACTOR.sub).toBe('svc_retool');
  });
});
