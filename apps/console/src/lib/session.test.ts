import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { actorForRole, decodeSession, encodeSession, primaryRole } from './session';

const SECRET = 'test-only-secret';

/**
 * The issuer reads SESSION_SECRET per call, so a test can pin it. That is also the
 * point of the fix: there is no compile-time default key to sign a forgery with.
 */
beforeAll(() => {
  process.env['SESSION_SECRET'] = SECRET;
});

function signedCookie(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${createHmac('sha256', SECRET).update(encoded).digest('base64url')}`;
}

describe('dev session cookie', () => {
  it('round-trips the OIDC-shaped claim set', () => {
    const actor = actorForRole('kyc_approver');
    const decoded = decodeSession(encodeSession(actor));
    expect(decoded).toEqual(actor);
    expect(Object.keys(actor).sort()).toEqual(['email', 'roles', 'sub']);
  });

  it('rejects a cookie whose payload was edited', () => {
    const cookie = encodeSession(actorForRole('kyc_reviewer'));
    const [, signature] = cookie.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'u-reviewer', email: 'rina.reviewer@example.com', roles: ['admin'] }),
      'utf8',
    ).toString('base64url');
    expect(decodeSession(`${forged}.${signature}`)).toBeUndefined();
  });

  it('rejects a malformed or absent cookie', () => {
    expect(decodeSession(undefined)).toBeUndefined();
    expect(decodeSession('garbage')).toBeUndefined();
    expect(decodeSession('a.b')).toBeUndefined();
  });

  it('rejects a correctly signed cookie carrying an unknown role', () => {
    expect(
      decodeSession(signedCookie({ sub: 'u', email: 'u@example.com', roles: ['superuser'] })),
    ).toBeUndefined();
  });

  it('rejects a correctly signed cookie with no roles or a non-string role', () => {
    expect(decodeSession(signedCookie({ sub: 'u', email: 'u@example.com', roles: [] }))).toBeUndefined();
    expect(decodeSession(signedCookie({ sub: 'u', email: 'u@example.com', roles: [7] }))).toBeUndefined();
    expect(decodeSession(signedCookie({ sub: 'u', email: 'u@example.com' }))).toBeUndefined();
  });

  it('never honours an unmask grant asserted by the cookie', () => {
    // The forgery the old issuer allowed: a validly signed payload with extra fields.
    const decoded = decodeSession(
      signedCookie({
        sub: 'u-reviewer',
        email: 'rina.reviewer@example.com',
        roles: ['kyc_reviewer'],
        unmaskGrants: [{ resourceType: 'kyc_cases', expiresAt: '2999-01-01T00:00:00.000Z' }],
      }),
    );
    expect(decoded).toEqual({
      sub: 'u-reviewer',
      email: 'rina.reviewer@example.com',
      roles: ['kyc_reviewer'],
    });
    expect(decoded?.unmaskGrants).toBeUndefined();
  });

  it('drops any other field the payload smuggles in', () => {
    const decoded = decodeSession(
      signedCookie({ sub: 'u', email: 'u@example.com', roles: ['auditor'], isAdmin: true }),
    );
    expect(Object.keys(decoded ?? {}).sort()).toEqual(['email', 'roles', 'sub']);
  });

  it('refuses to issue a session in production without SESSION_SECRET', () => {
    const secret = process.env['SESSION_SECRET'];
    const nodeEnv = process.env['NODE_ENV'];
    try {
      delete process.env['SESSION_SECRET'];
      process.env['NODE_ENV'] = 'production';
      expect(() => encodeSession(actorForRole('admin'))).toThrow(/SESSION_SECRET is required/);
    } finally {
      if (secret !== undefined) process.env['SESSION_SECRET'] = secret;
      if (nodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = nodeEnv;
    }
  });

  it('reports the persona the switcher should preselect', () => {
    expect(primaryRole(actorForRole('auditor'))).toBe('auditor');
  });
});
