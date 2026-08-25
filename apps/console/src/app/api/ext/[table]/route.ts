/**
 * The external ("rented UI") data surface — how a Retool/Appsmith would call us.
 *
 * Authentication is a Bearer identity assertion and nothing else. Deliberately no
 * cookie fallback: this route exists to prove that the data layer can bind every
 * request to the human the session issuer vouched for, independent of anything the
 * calling UI asserts. The UI cannot mint an assertion, replay an expired one, or
 * escalate one — `verifyAssertion` refuses and audits all three.
 *
 * `?as=service` (dev only) authenticates as the `svc_retool` machine account — the
 * failure mode this boundary defends against. The query succeeds either way; the
 * difference is on the audit chain, where the service-account rows name a machine
 * instead of a person. That contrast is the demo.
 *
 * This proves the API-boundary half of identity binding only. The database-boundary
 * half (Postgres RLS keyed off a per-request session variable) cannot exist on
 * SQLite and is not claimed here — see ARCHITECTURE.md §3.8.
 */
import {
  PolicyDeniedError,
  SERVICE_ACTOR,
  isKnownTable,
  listRows,
  verifyAssertion,
  withAudit,
  type Actor,
} from '../../../../core-adapter/index';

export const dynamic = 'force-dynamic';

function unauthorized(reason: string): Response {
  return Response.json({ error: reason }, { status: 401 });
}

function authenticate(request: Request): Actor | Response {
  const url = new URL(request.url);
  if (url.searchParams.get('as') === 'service') {
    if (process.env.NODE_ENV === 'production') {
      return unauthorized('service-account access is a dev-only demo');
    }
    return SERVICE_ACTOR;
  }

  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return unauthorized('missing Bearer identity assertion');
  }
  try {
    return verifyAssertion(header.slice('Bearer '.length));
  } catch (error) {
    // The refusal is already on the audit chain (decision: 'deny').
    if (error instanceof PolicyDeniedError) return unauthorized(error.decision.reason);
    throw error;
  }
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ table: string }> },
): Promise<Response> {
  const { table } = await ctx.params;
  if (!isKnownTable(table)) {
    return Response.json({ error: `unknown table ${table}` }, { status: 404 });
  }

  const actor = authenticate(request);
  if (actor instanceof Response) return actor;

  try {
    // Reads on this surface are audited: an external system pulling rows is exactly
    // the access an examiner asks about, and the row must name who pulled them.
    const rows = withAudit({
      actor,
      action: 'record.read',
      resource: { type: table, id: '*' },
      diff: { surface: 'ext' },
      mutate: () => listRows(table, actor),
    });
    return Response.json({ table, actor: { sub: actor.sub, email: actor.email }, rows });
  } catch (error) {
    if (error instanceof PolicyDeniedError) {
      return Response.json({ error: error.decision.reason }, { status: 403 });
    }
    throw error;
  }
}
