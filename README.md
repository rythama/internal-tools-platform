# Internal Tools Platform

A prototype exploring whether a ~60-engineer fintech should build its internal
tools instead of renting a low-code platform — and what the code has to look like
for that to be a defensible decision rather than an expensive one.

Built with [Devin](https://devin.ai) as the primary implementation tool. The
process is documented in [docs/DEVIN-WORKFLOW.md](docs/DEVIN-WORKFLOW.md) and is
as much a deliverable as the code.

> **Status:** prototype, ~2 hours of build time. Not production software.
> Known gaps are listed at the bottom — deliberately, since an honest gap list is
> more useful to the decision than a polished demo.

## What this is

One console hosting many internal tools. Each tool is a spec file; the shared
platform underneath provides the things every internal tool needs and every team
otherwise rebuilds badly:

- **Deny-by-default authorization** through a single pure `can()` choke point,
  making the policy matrix exhaustively testable.
- **Append-only, hash-chained audit** written in the same transaction as the
  mutation, so no action can commit without its audit record.
- **Field-level PII masking** driven by schema classification, where unmasking is
  itself an audited event.
- **Maker–checker approvals** as one generic primitive rather than per-tool logic.

Three tools ship on it: a **KYC review queue** (the anchor workflow), a **refunds
dashboard**, and a **feature-flag admin panel** — the same three the client runs
on Power Apps today.

## Why this shape

The architecture is organized around one claim: **it should be structurally difficult
for the eleventh tool to get audit or access control wrong.**

It is deliberately *not* organized around making the eleventh tool cheap. We costed
that and it does not hold — marginal per-tool cost comes out at roughly parity with
building the same tool properly in Power Apps, because most of the per-tool work
(requirements, security review, UAT, cutover) is not code. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §1 for the correction and what replaced it.

The escape hatch matters as much as the spec: any tool that outgrows the
declarative model drops into custom React against the same primitives. That is
the capability a low-code platform cannot offer, and it is the strongest
non-financial argument for owning this code.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the decisions and their rationale.

## Run it

```bash
npm install
npm run db:seed
npm run dev
```

Open http://localhost:3000. Use the role switcher in the header to see how the
same screens change for `kyc_reviewer`, `kyc_approver`, and `auditor` — permission
differences are visible, not theoretical.

No database server required: SQLite via Drizzle, with a Postgres-shaped schema.
That is a prototype tradeoff, not a production recommendation.

```bash
npm run verify   # typecheck, lint, tests, audit-chain integrity
```

## Try the thing that matters

1. As `kyc_reviewer`, open a high-risk case — `taxId` is masked.
2. Unmask it with a reason. Check `/audit`: the unmask is on the chain.
3. Approve it. Because risk ≥ 80, it becomes a **request**, not an approval.
4. Try to approve your own request. You can't.
5. Switch to `kyc_approver` and sign off.
6. Open `/audit` — every step, including the denials, hash-chained and verifiable.

Step 6 is the argument. That audit trail lives in your database, under your backup
policy, verifiable by your auditors, with no vendor in the trust path.

## Known gaps

Prototype scope. Real deployment would need: a real OIDC provider (the session is
a signed-cookie stub), Postgres with proper migrations, PII encryption at rest,
rate limiting, secrets management, and an on-call owner. The last one is not a
technical gap and it is the one most likely to be underestimated.
