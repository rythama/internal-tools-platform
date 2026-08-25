# How this repo is built with Devin

This file is part of the deliverable. The client's question is not "can an AI write
CRUD" — it is "can a 60-engineer fintech run a fleet of internal tools this way
without it becoming a liability." The answer depends almost entirely on the setup
below, so we document it as a repeatable process rather than a one-off.

## The operating principle

**Humans own the architecture and the verification harness. Devin owns the
implementation inside it.**

Everything in this repo authored before the first session — `docs/ARCHITECTURE.md`,
`packages/core/src/db/schema.ts`, the contract in `packages/core/src/index.ts`,
`.github/workflows/ci.yml` — is the guardrail. It took roughly 30 minutes.

An earlier draft claimed this made agent PRs "reviewable in ~10 minutes instead of ~2
hours." That was an unmeasured 12x claim and it is withdrawn. What the guardrail
actually does is make review **bounded and repeatable** — the same four things to check
every time, with the mechanical invariants already proven by CI — rather than fast. The
session log below is where the real numbers go, including the ones that do not flatter
the approach.

Skip this step and you get 13 inconsistent apps that each invented their own
auth. That is the actual failure mode of "just have Devin build it," and it is
worth being explicit with the client about it.

## Repo setup (do this before the first session)

**Setup command:** `bash scripts/setup.sh`
Idempotent, no external services, ~60s on a clean VM. A flaky setup command
poisons every session that follows it.

**Knowledge entries** (Devin settings → Knowledge, scoped to this repo):

| Trigger | Knowledge |
|---|---|
| Always | `docs/ARCHITECTURE.md` is normative. Do not re-litigate its decisions; raise conflicts in the PR description instead. |
| Auth or permissions | All authorization goes through `can()` in `packages/core/src/policy`. Never compare roles inline. New actions require new policy tests. |
| Any DB mutation | Mutations go through `withAudit()`. Never write a domain table directly. `audit_log` has no UPDATE or DELETE path. |
| Anything touching customer data | PII classification lives in `piiColumns` in `schema.ts`. Never log, never put in a URL, never store in clear in an audit diff. |
| Adding a tool | Prefer a `tools/<name>/spec.ts`. Custom React is allowed but must be justified in the PR. |

**Verification:** `npm run verify` (typecheck, lint, test, audit chain). Devin runs
this before opening a PR, so CI failures are rare and mean something when they happen.

## Session plan

| # | Session | Depends on | Parallel? |
|---|---|---|---|
| 1 | core primitives | — | ✅ with 2 |
| 2 | console shell | — (builds against declared contract) | ✅ with 1 |
| 3 | KYC review queue | 1, 2 | sequential |
| 4 | refunds + feature flags | 3 | sequential |

Sessions 1 and 2 run concurrently *because the contract was seeded first*. That is
the general lesson for the client: **interface-first design is what makes parallel
agents usable.** Without it you serialize, and the throughput argument evaporates.

Prompts are in `devin/tasks/`. They are committed rather than pasted ad hoc — a
prompt that produced a merged PR is a reusable asset, which is what turns
"we used an AI once" into a repeatable process for tool #11.

## Playbook: adding a new internal tool

1. Write `tools/<name>/spec.ts` with the queue, detail, and actions.
2. Add any new actions to the policy rules **and** the policy test matrix.
3. Open a Devin session: *"Implement the tool described in tools/<name>/spec.ts.
   Follow docs/ARCHITECTURE.md. Add tests for the approval and PII behaviour."*
4. Review: policy diff, audit coverage, PII handling. Then the rest.

The review checklist is deliberately short and always the same. Reviewing the
11th agent-authored tool should be boring — if it isn't, the platform is
under-built and that is the signal to invest in core.

## Session log

Schema fixed **before** the first session, so the numbers are measured rather than
reconstructed. `corrections` is the honest column and the one the client's VP should
care about most: it is the only figure here that speaks to review load, and review
load — not agent speed — is the binding constraint on this platform's economics.

A correction is any human intervention before merge: a redirect, a "no, do it this
way," or a fix authored by hand. Zero is a legitimate result. So is six.

| # | Session | Started | PR opened | Wall-clock | ACUs | Corrections | Net LOC | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | core primitives | 2026-08-24 20:24 | | | | | | running |
| 2 | console shell | 2026-08-24 20:24 | | | | | | running, concurrent with 1 |
| 3 | KYC review queue | | | | | | | not started |
| 4 | refunds + flags | | | | | | | not started |

Sessions 1 and 2 were launched concurrently against the same repo. Session 2 builds
against a contract session 1 is implementing at the same time — whether that actually
works is a finding, not an assumption, and it gets reported either way.
