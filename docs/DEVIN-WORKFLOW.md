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

| # | Session | Started | PR opened | Wall-clock | Human review | Corrections | Net LOC | Notes |
|---|---|---|---|---|---|---|---|---|
| 1a | core primitives | 20:24 | — | — | — | — | — | **Operator-stopped** during an account migration. Not a Devin failure; draw no conclusion from this row. |
| 2 | console shell | 20:24 | 20:33:40 | **9m 40s** | **0 min** | 0 | +2,923 | [PR #1](https://github.com/rythama/internal-tools-platform/pull/1). Merged 17s after opening — unread. |
| 1b | core primitives | 20:53 | 21:00:06 | **7m 06s** | **5–10 min** | 0 | +2,228 | [PR #2](https://github.com/rythama/internal-tools-platform/pull/2). 216 tests. Reviewed, then merged. |
| 3 | KYC review queue | 21:09 | 21:29:31 | **20m 31s** | **10–15 min** | 0 | +1,474 / −954 | [PR #3](https://github.com/rythama/internal-tools-platform/pull/3). Real core, stubs deleted, 2 of 4 named defects fixed. |
| 4 | refunds + flags | — | — | — | — | — | — | **Deliberately not run.** It existed to measure marginal per-tool cost; the economic analysis already put that at parity with Power Apps, so the measurement no longer moves the recommendation. |

**Totals: ~37 minutes of agent time, ~5,600 net lines, 211 tests. ~20–25 minutes of human
review across three PRs, one of which got zero.**

Review time rose with criticality — 0 → 5–10 → 10–15 minutes — which is the right direction
and still an order of magnitude below what the volume warrants.

¹ ACU consumption for session 2 was lost when the account changed mid-run. Recorded as
unavailable rather than estimated. The rate card itself was never obtained in writing, so any
dollar figure derived from it would be fabricated precision.

### What session 2 actually shows

### The review finding, which is the point of this table

Session 1b produced **2,228 lines in 7 minutes**. It was reviewed for **5–10 minutes** before
merging.

Commonly cited careful-review throughput is 200–400 LOC/hour [A]. At that rate, 2,228 lines is
**six to eleven hours**. The review that actually happened was roughly **1–2% of that**.

This matters because the economic model assumes review is the binding constraint and *inflates*
~1.3x on agent-authored code. That is not what happened here. Faced with 2,228 lines arriving in
seven minutes, the reviewer did not spend more hours — **the depth of review silently fell to fit
the time available.**

> **The review tax does not get paid. It gets skipped.**

That is the honest failure mode, and it is worse than the one the model priced, because it is
invisible: CI stays green, the PR merges, and the cost surfaces later as a defect rather than
sooner as an hour. Both merges in this repository followed the pattern, in a repository built
specifically to prevent it, by the people making the argument.

The three real defects found in this codebase were found by a rival Devin session and by an
automated review pass — **none by a human reading the diff.**

**Zero corrections is not the same as zero defects.** The PR was merged **17 seconds** after it
opened. CI was green, so it went in unread — 2,933 lines. That is the reviewer-fatigue failure
mode reproduced on the first PR, in a repository built specifically to guard against it, by the
people making the argument. It is reported here rather than quietly fixed because it is the most
honest datum in this document.

A proper review was run afterwards; findings are in `docs/PR1-REVIEW.md`.

**What the agent did well, unprompted:**

- Did not weaken the lint guardrail. It added two narrowly-scoped, commented exemptions and
  disclosed both in the PR body rather than rewriting expressions to slip past the selectors.
- Volunteered that the guardrail is weaker than its author claimed: the rule matches *syntax*,
  so destructuring the roles property evades it. It raises the cost of an accidental inline role
  check; it is not a containment boundary. That correction came from the agent, not the human.
- Shipped a banner making the stub state visible, on the reasoning that a demo which silently
  looks finished is how a prototype gets mistaken for a product.

**Four design errors it found in the human-authored contract:**

1. **No read API.** `packages/core/src/index.ts` declared only mutations, while the architecture
   forbids the console from touching the database. Queue, detail and audit views are all reads —
   the shell was unbuildable as specified.
2. `requestApproval(action)` and `can(permission)` use different vocabularies with no mapping.
3. `withAudit()` documents auditing denials but returns `T`, with no channel for the caller to
   learn it was denied.
4. Task 02 specified filesystem discovery of `tools/*/spec.ts`, which a bundler cannot do.

All four are errors in the seed, authored by a human before any session ran. The guardrails
constrained the agent; they did not make the human right.
