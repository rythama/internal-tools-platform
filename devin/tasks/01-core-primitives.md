# Session 1 — core primitives (@itp/core)

**Branch:** `devin/01-core-primitives` · **Runs:** immediately, in parallel with Session 2

Read `docs/ARCHITECTURE.md` first. It is normative.

## Goal
Implement the declared contract in `packages/core/src/index.ts`. The signatures and
the schema in `packages/core/src/db/schema.ts` are fixed — implement against them,
do not redesign them.

## Deliverables
1. `policy/` — `can()` as a pure, total, deny-by-default function. Rules as data
   (an array of typed rules), not a chain of `if`s, so the matrix is enumerable in tests.
2. `audit/` — `withAudit()` writing the mutation and its audit row in one
   `better-sqlite3` transaction; `verifyAuditChain()`; `verify-cli.ts` exiting non-zero
   on a break. Hash = sha256 over `prevHash || canonicalJSON(row-without-hash)`.
   Canonicalization must sort keys — an unstable hash makes the chain worthless.
3. `pii/` — `maskRow()` driven by `piiColumns`. `'high'` → fully redacted,
   `'low'` → partial (`a***@example.com`, `**** 4242`). Unmasking emits an audit event.
4. `approvals/` — the state machine. Self-approval rejected when
   `disallowSelfApproval`. Applying a satisfied approval is idempotent.
5. **Read API** — `listRows`, `getRow`, `listAuditRows`, `listApprovals`. These were
   missing from the first version of the contract; the console cannot render a queue,
   detail page, approvals panel or audit view without them, and components are
   forbidden from touching the database.

   **The load-bearing property: each applies `maskRow()` before returning, and none
   takes an `unmask` parameter.** Masking must not be a call-site decision — an unmask
   is a separate, individually audited action. Each is also authorization-scoped: rows
   the actor may not see are absent from the result, not merely hidden by the UI.

6. `CORE_IMPLEMENTED` — export it as `true`. The console feature-detects on this rather
   than on the presence of `can`, so a partial implementation (mutations landed, reads
   not yet) is visible instead of silently serving stub reads alongside real writes.

7. `db/seed.ts` — deterministic seed: ~40 KYC cases with a realistic risk/SLA spread
   (some breaching), ~25 refunds spanning the approval threshold, ~12 flags. Fake
   data only — no real PII, no real card numbers.

## Tests (these are the acceptance criteria)
- Policy matrix: every (role × action) pair asserted, including the deny cases.
  A new action without a policy test must fail CI.
- Audit: tampering with any historical row makes `verifyAuditChain()` report that seq.
- Audit: a mutation whose audit write throws leaves **no** domain row behind.
- PII: a `'high'` column never appears in clear for an actor without a grant —
  assert on the serialized payload, not just the return value.
- Approvals: requester cannot self-approve; N-of-M satisfaction; double-apply is a no-op.

## Context: the console already exists
`apps/console` and `packages/ui` were built in a parallel session and are merged on
`main`. The console binds to this package through a runtime feature-detect in
`apps/console/src/core-adapter/index.ts`, falling back to a local stub. **When your
implementation lands, the console should pick it up with no edit to the console.**

Match the declared signatures exactly. When you are done, the stub files
(`core-adapter/policy-stub.ts`, `core-adapter/stub-runtime.ts`) should be deletable —
but do not delete them in this PR; that is a separate, reviewable change.

## Do not
- Do not add an UPDATE or DELETE path for `audit_log`.
- Do not read roles from anywhere but the passed `Actor`.
- Do not introduce Postgres, Docker, or a migration tool. SQLite only, per §3.1.
- Do not edit `apps/console/` or `packages/ui/`. If the console must change for your
  implementation to bind, say so in the PR description instead of changing it.

## Done when
`npm run verify` passes locally and CI is green on the PR.
