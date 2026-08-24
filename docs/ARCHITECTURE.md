# Architecture

This document is normative. Devin sessions must not re-litigate these decisions.
If a task appears to require violating one, stop and raise it in the PR description
instead of working around it.

## 1. The problem we are actually solving

We are not rebuilding Power Apps. We are removing the reason internal tools were
uneconomical to build in-house: every tool re-implemented auth, RBAC, audit,
tables, forms, and deploy from scratch.

Those are fixed costs. We pay them **once**, in `packages/core`, and every
subsequent tool becomes a spec file plus whatever custom React it genuinely needs.

> **Correction, after costing this properly.** An earlier draft of this document said
> the design target was *"app #11 is cheap."* That premise did not survive the economic
> analysis. Marginal per-tool cost lands around $40K fully loaded on this platform
> versus roughly $39K to build the same tool properly in Power Apps — **parity**. Only
> ~12% of per-tool work is agent-compressible; the rest is requirements elicitation,
> security review, UAT, and cutover, none of which the architecture or the agent touches.
>
> The design target that survives is the second half: **app #11 cannot violate the
> audit or access rules by accident.** That is a capability claim, not a cost claim,
> and it is the only one the numbers support. Everything below is organized around it.

This matters for how you read the rest of the document. `packages/core` is not here to
make tools cheap. It is here to make a class of mistakes structurally unavailable.

## 2. Shape

One deployment. Many tools.

```
apps/console            Single Next.js host. One thing to deploy, secure, monitor.
  src/app/t/[tool]/     Dynamic routes rendered from a tool spec.
packages/core           Fixed costs live here. Deny-by-default, audited, typed.
packages/ui             Schema-driven queue / detail / form primitives.
tools/<name>/spec.ts    One file per internal tool.
```

A tool that outgrows the spec drops into custom React in `apps/console` and calls
the same `packages/core` primitives. **This escape hatch is the point.** It is the
capability a low-code platform structurally cannot offer, and it is why the ceiling
here is higher than Power Apps even though the floor is lower.

## 3. Decisions

### 3.1 Storage: SQLite now, Postgres shaped
Drizzle ORM against `better-sqlite3` so `npm install && npm run dev` works with zero
infrastructure — for reviewers and for Devin's VM. The schema is written to
Postgres semantics (explicit timestamps, no SQLite-only types in domain tables).
Production swaps the driver.

This is a prototype tradeoff, stated openly. It is not a production recommendation.

### 3.2 Identity: OIDC-shaped, stubbed
Sessions carry `{ sub, email, roles[] }` — the exact claim shape an OIDC provider
returns. The dev stub is a signed cookie with a role switcher. Swapping in Okta or
Entra ID replaces the session issuer only; **no policy or audit code changes.**
Nothing downstream may read identity from anywhere but the session object.

### 3.3 Authorization: one choke point, deny by default
Every mutation and every sensitive read passes through:

```ts
can(actor: Actor, action: Action, resource: Resource): Decision
```

Rules:
- Deny-by-default. An action with no matching rule is denied.
- `can()` is pure and total — no I/O, no throwing. It returns a `Decision` with a reason.
- Because it is pure, it is exhaustively unit-testable. **The policy test suite is
  the security review.** Devin PRs that add an action without adding policy tests fail CI.
- No `if (user.role === 'admin')` anywhere outside `packages/core/policy`. Lint-enforced.

### 3.4 Audit: append-only, hash-chained, same transaction
Every mutation writes an audit row inside the same DB transaction as the mutation
itself. Not a middleware. Not a logger. Same transaction — so an action cannot
commit without its audit record.

Each row carries `prev_hash` and `hash = H(prev_hash || canonical(row))`, giving a
tamper-evident chain. A verifier walks the chain and reports the first break.

This is the single most defensible reason a fintech should own this code rather than
rent it: the audit trail is in your database, in your backup policy, verifiable by
your auditors, with no vendor in the trust path.

### 3.5 PII: classified in the schema, masked at the boundary
Columns are tagged at the schema level (`pii: 'high' | 'low' | none`). The data-access
layer masks tagged fields unless the actor holds an explicit unmask grant.

**Unmasking is itself an audited action.** "Who looked at this customer's SSN, and
when" is a query, not an investigation.

### 3.6 Maker–checker as a core primitive, not per-tool logic
One generic `approvals` table plus a state machine. A tool declares in its spec that
an action requires N approvals from a role, and optionally that approver ≠ requester.

Two-person control implemented once, tested once, applied everywhere — rather than
re-derived per tool, which is where it eventually gets derived wrong.

### 3.7 Tool specs
A spec declares: data source, queue columns and filters, detail layout, actions with
their required permissions and approval rules, and PII visibility.

The spec is TypeScript, not JSON or YAML. It typechecks against the schema, so a
column rename breaks the build instead of breaking production at 2am.

## 4. Verification harness (read this before opening a session)

Devin's output quality is bounded by what the repo can prove about it. CI is seeded
**before** the first session and must stay green:

- `typecheck` — strict, no `any` in `packages/core`
- `test` — policy matrix, audit chain integrity, PII masking, approval state machine
- `lint` — includes the custom rule banning role checks outside the policy module
- `audit:verify` — walks the hash chain of the seeded database

These tests encode the invariants a regulator cares about. They are the guardrail
that makes agent-authored changes to a regulated system reviewable at all.

**What the harness does not do is make review fast.** Review scales with code volume and
criticality, not with how quickly the code appeared. On agent-authored code it is
somewhat *more* expensive per line than reviewing a colleague's: there is no author to
ask "why this way," and the characteristic failure is plausible-but-wrong, which survives
skimming. What CI buys is a *bounded* review — a fixed checklist, with the mechanical
invariants already proven — not a short one. Review is the binding constraint on this
platform's economics and no amount of agent speed relieves it.
