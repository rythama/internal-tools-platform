# Key Decisions

*For Cognition. What I built, why that scope, and where the reasoning moved.*

## The reframe that set the scope

"Can Devin build these tools?" isn't the question — CRUD over Postgres isn't hard. The question
is whether owning ~13 internal tools costs less than $250K/year once you count the platform
underneath, the person who owns it, and the compliance surface it drags into scope.

So I scoped around the **eleventh** tool, not the first: one console hosting many tools, each a
spec over shared primitives — deny-by-default authorization, hash-chained audit, PII masking with
audited break-glass, maker-checker approvals. Anchored on the KYC queue because it forces all four
to be load-bearing at once.

I deliberately did **not** replicate the two things Power Apps is genuinely good at: citizen
development and the connector catalogue. Devin makes engineer-hours cheap; it doesn't turn an ops
analyst into an app author.

## Three architectural decisions

**Guardrails before agents.** Architecture doc, schema, core contract and CI hand-written *before*
the first session — because an agent's output is bounded by what the repo can prove about it.

**Interface-first, so sessions could run concurrently.** I declared the core contract up front so
two sessions could build against it simultaneously. It worked: core landed and the console bound
to it with **zero console edits**. That's the throughput argument, demonstrated rather than asserted.

**Masking as a structural property.** The read API masks internally and takes no `unmask`
parameter. An API that lets the caller opt out of masking is an API through which PII leaks.

## The thesis moved twice

I opened with "build a framework." Marginal per-tool cost came out at **parity** with Power Apps
(~$40K vs ~$39K) — only ~12% of per-tool work is agent-compressible. The premise my architecture
was organized around was wrong; the repo now says so in `ARCHITECTURE.md §1`.

I moved to "own the primitives, rent the UI." A red-team pass then found six tier-1 errors in my
own model — including an unjustified 3.2× maintenance penalty against the incumbent, and a
recommendation whose own corrective action was never applied to its baseline. Corrected, **split-
the-stack never breaks even** at any tool count, discount rate, or horizon.

So the recommendation isn't a saving. It's a **capability purchase at ~$400K/yr**: renting the UI
alone buys ~65% of the four primitives at ~$125–145K/yr; owning the primitives buys the last ~30%
for ~$260–275K/yr. Sold as "saves money," it dies in the room.

## What the prototype actually measured

Three sessions: ~37 minutes of agent time, ~5,600 lines, 211 tests, ~20–25 minutes of human review.
Two findings, both against me.

**The verification harness proved none of the invariants it advertised.** Mutation testing: delete
PII masking — 54/54 green. Defeat the two-person rule — green. Remove the four-eyes gate — green.
The lint rule I called "machine-checked" is evaded five ways, including the idiom the repo's own
policy module uses. I built more apparatus than most teams do, deliberately, and it caught none of it.

**Review doesn't scale with lines; it scales with load-bearing claims — and reading doesn't find
them.** Every confirmed defect was correct-looking code wrong in one conjunct
(`.length >= requiredApprovals`, `typeof value === 'number' &&`). Finding them took *executing
mutations*. PR #1 merged unread 17 seconds after opening; the tax wasn't paid, it was skipped,
invisibly, because CI stayed green.

The fix worked: session 3's tests assert audit rows and state transitions rather than functions,
and now kill 5/5 mutants. But that only happened because we measured.

## What I'd flag

I over-ranked the hardcoded session secret as critical. It's major — `/api/session` hands out any
role by design, so the secret confers no incremental privilege. The genuine critical was a
two-person rule counting votes rather than voters.

The prototype demonstrates the primitives, not the recommendation. Its crux — binding a *rented*
UI's queries to an identity it can't forge — is untested here and is the pilot's Week-2 gate.
That, plus mutation testing in CI, is where the next two hours go. Not more tools.
