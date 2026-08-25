import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { actorForRole, decodeSession, encodeSession, primaryRole } from './session';

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
    const payload = Buffer.from(
      JSON.stringify({ sub: 'u', email: 'u@example.com', roles: ['superuser'] }),
      'utf8',
    ).toString('base64url');
    const signature = createHmac('sha256', 'dev-only-insecure-session-secret')
      .update(payload)
      .digest('base64url');
    expect(decodeSession(`${payload}.${signature}`)).toBeUndefined();
  });

  it('reports the persona the switcher should preselect', () => {
    expect(primaryRole(actorForRole('auditor'))).toBe('auditor');
  });
});
