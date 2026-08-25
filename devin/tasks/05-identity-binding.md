# Session 5 — identity binding at the API boundary

**Branch:** `devin/05-identity-binding` · **Depends on:** sessions 1–3 merged

## Why this session exists

The recommendation this prototype supports is "own the compliance primitives, rent the UI
(Retool/Appsmith)." The technical crux of that architecture — the thing a skeptical VP will
attack first — is identity: a rented UI typically connects to your data layer with a
**service account**, which defeats every primitive at once. Row scoping evaporates, and the
audit chain records `retool_svc` instead of the human. A log that names a service account is
a log, not an audit trail.

The full mechanism has two halves:

1. **API boundary** — every data-layer request must carry a signed, short-lived assertion of
   the *human's* identity, minted by the session issuer, that the data layer verifies
   independently. The UI cannot mint one, replay an expired one, or escalate one.
2. **Database boundary** — Postgres RLS keyed off a per-request session variable, with the
   UI's role restricted to security-definer functions.

Half 2 needs Postgres and is deliberately out of scope (SQLite has no RLS; it is the pilot's
Week-2 gate). **This session builds and proves half 1.** Be precise about that boundary in
code comments and the PR — overclaiming here would poison the exact argument it exists to
support.

## Deliverables

1. `packages/core/src/assert/` — the identity assertion:
   - `mintAssertion(actor, opts)` — HMAC-signed, carries `{ sub, email, roles, iat, exp }`,
     TTL default 60s. Refuses to mint if the signing secret is unset (fail closed — see the
     session-secret finding in docs/PR1-REVIEW.md; do not repeat it).
   - `verifyAssertion(token)` — returns the Actor or throws. Constant-time comparison.
     Expired, tampered, alg-confused, or role-escalated tokens are all refused **and the
     refusal is audited** with `decision: 'deny'` — a rejected assertion is an attempted
     access, which is exactly what an examiner wants on the chain.
2. A new route `apps/console/src/app/api/ext/[table]/route.ts` — the "rented UI" surface:
   a GET returning `listRows` output, authenticated **only** by an `Authorization: Bearer
   <assertion>` header. No cookie fallback. This simulates how Retool would call us: the
   session issuer mints the assertion, the UI passes it through, the data layer trusts only
   the verification, never the caller.
3. The demo of the failure mode we are defending against: the route also accepts
   `?as=service` **in dev only**, which authenticates as a `svc_retool` machine actor. The
   response works — but every audit row then names `svc_retool`, and a
   test asserts the difference: same query, human assertion vs service account, and the
   audit rows name the human in one case and the machine in the other. That contrast IS the
   demo. Make it visible in the audit view.
4. Tests, all of which must fail before the implementation exists:
   - expired assertion → refused, audited
   - tampered payload (role added) → refused, audited
   - assertion minted with a different secret → refused
   - valid assertion → rows returned are masked and scoped exactly as `listRows` scopes them
   - the service-account contrast test described above
5. A short section appended to `docs/ARCHITECTURE.md` (§3.8) stating precisely what half 1
   proves, what half 2 requires, and why the split is honest.

## Do not

- Do not add a JWT library. HMAC over canonical JSON with the existing hash util is enough
  for a prototype and keeps the verification legible in one file.
- Do not weaken or bypass the existing session cookie path — this is an *additional*
  authentication surface, not a replacement.
- Do not claim RLS. SQLite cannot express it; say so where it matters.

## Done when

`npm run verify` is green, the contrast test passes, and the audit view shows the same query
attributed to a human in one row and `svc_retool` in the next.
