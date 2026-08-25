/**
 * The external ("rented UI") surface, exercised the way Retool would call it: a GET
 * with a Bearer identity assertion and nothing else. The contrast test at the bottom
 * is the point of this surface — the same query, run once with a human assertion and
 * once as the service account, must produce audit rows naming the human in one case
 * and the machine in the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAuditRows, listRows, type Actor } from '../../../core-adapter/index';
import {
  db,
  raw,
  useInMemoryDatabaseForTests,
} from '../../../../../../packages/core/src/db/client';
import { kycCases } from '../../../../../../packages/core/src/db/schema';
import {
  useFixedClock,
  useSystemClock,
} from '../../../../../../packages/core/src/clock';
import {
  ASSERTION_SECRET_ENV,
  SERVICE_ACTOR,
  mintAssertion,
} from '../../../../../../packages/core/src/assert/index';
import { GET } from './[table]/route';

const REVIEWER: Actor = { sub: 'u-reviewer', email: 'rina@example.com', roles: ['kyc_reviewer'] };
const AUDITOR: Actor = { sub: 'u-auditor', email: 'ada@example.com', roles: ['auditor'] };

function seedCase(id: string): void {
  db()
    .insert(kycCases)
    .values({
      id,
      status: 'pending',
      riskScore: 10,
      submittedAt: '2025-02-01T00:00:00.000Z',
      slaDueAt: '2025-02-03T00:00:00.000Z',
      legalName: `Subject ${id}`,
      dateOfBirth: '1970-04-05',
      taxId: '900000001',
      country: 'GB',
      sanctionsHit: false,
    })
    .run();
}

function request(url: string, headers?: Record<string, string>): Promise<Response> {
  return GET(new Request(url, { headers: headers ?? {} }), {
    params: Promise.resolve({ table: 'kyc_cases' }),
  });
}

function auditActors(): Array<{ actor_sub: string; actor_email: string; decision: string }> {
  return raw()
    .prepare('select actor_sub, actor_email, decision from audit_log order by seq')
    .all() as Array<{ actor_sub: string; actor_email: string; decision: string }>;
}

beforeEach(() => {
  useInMemoryDatabaseForTests();
  useFixedClock('2025-03-01T00:00:00.000Z', 0);
  vi.stubEnv(ASSERTION_SECRET_ENV, 'route-test-secret');
  seedCase('KYC-1');
  seedCase('KYC-2');
});

afterEach(() => {
  vi.unstubAllEnvs();
  useSystemClock();
});

describe('GET /api/ext/[table]', () => {
  it('refuses a request with no Authorization header — there is no cookie fallback', async () => {
    const response = await request('http://localhost/api/ext/kyc_cases', {
      cookie: 'itp_session=whatever-a-browser-might-send',
    });
    expect(response.status).toBe(401);
  });

  it('refuses an expired assertion and the refusal lands on the audit chain', async () => {
    const token = mintAssertion(REVIEWER, { ttlSeconds: 60 });
    useFixedClock('2025-03-01T00:02:00.000Z', 0);

    const response = await request('http://localhost/api/ext/kyc_cases', {
      authorization: `Bearer ${token}`,
    });
    expect(response.status).toBe(401);
    expect(auditActors()).toEqual([
      { actor_sub: 'u-reviewer', actor_email: 'rina@example.com', decision: 'deny' },
    ]);
  });

  it('refuses an assertion minted with a different secret', async () => {
    vi.stubEnv(ASSERTION_SECRET_ENV, 'not-the-servers-secret');
    const token = mintAssertion(REVIEWER);
    vi.stubEnv(ASSERTION_SECRET_ENV, 'route-test-secret');

    const response = await request('http://localhost/api/ext/kyc_cases', {
      authorization: `Bearer ${token}`,
    });
    expect(response.status).toBe(401);
  });

  it('returns rows masked and scoped exactly as listRows scopes them', async () => {
    const response = await request('http://localhost/api/ext/kyc_cases', {
      authorization: `Bearer ${mintAssertion(REVIEWER)}`,
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { rows: Array<Record<string, unknown>> };
    expect(body.rows).toEqual(listRows('kyc_cases', REVIEWER));
    expect(body.rows).toHaveLength(2);
    // PII classified 'high' never leaves this surface in clear.
    expect(body.rows[0]?.['taxId']).toBe('[redacted]');
  });

  it('rejects the service-account path outside dev', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = await request('http://localhost/api/ext/kyc_cases?as=service');
    expect(response.status).toBe(401);
  });

  it('names the human in one audit row and the machine in the other for the same query', async () => {
    const human = await request('http://localhost/api/ext/kyc_cases', {
      authorization: `Bearer ${mintAssertion(REVIEWER)}`,
    });
    const machine = await request('http://localhost/api/ext/kyc_cases?as=service');
    expect(human.status).toBe(200);
    expect(machine.status).toBe(200);

    // Same query, same rows returned — the data layer cannot tell the difference
    // from the response alone. The audit chain can, and that contrast is the demo.
    const actors = auditActors();
    expect(actors).toEqual([
      { actor_sub: 'u-reviewer', actor_email: 'rina@example.com', decision: 'allow' },
      { actor_sub: 'svc_retool', actor_email: SERVICE_ACTOR.email, decision: 'allow' },
    ]);

    // And the audit view (listAuditRows) shows both attributions side by side.
    const view = listAuditRows(AUDITOR).map((row) => row.actorEmail);
    expect(view).toContain('rina@example.com');
    expect(view).toContain(SERVICE_ACTOR.email);
  });
});
