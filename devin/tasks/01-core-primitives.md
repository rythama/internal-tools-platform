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
5. `db/seed.ts` — deterministic seed: ~40 KYC cases with a realistic risk/SLA spread
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

## Do not
- Do not add an UPDATE or DELETE path for `audit_log`.
- Do not read roles from anywhere but the passed `Actor`.
- Do not introduce Postgres, Docker, or a migration tool. SQLite only, per §3.1.

## Done when
`npm run verify` passes locally and CI is green on the PR.
