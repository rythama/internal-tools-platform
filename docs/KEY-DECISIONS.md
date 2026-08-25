# Key Decisions

*For Cognition. What I built, why that scope, and where the reasoning moved.*

## The reframe that set the scope

"Can Devin build these tools?" is not the question — Next.js CRUD over Postgres is not hard.
The question is whether owning ~13 internal tools costs less than $250K/year once you count
the platform underneath them, the person who owns it, and the compliance surface it drags
into scope.

So I scoped the prototype around the **eleventh** tool, not the first: one console hosting many
tools, each a spec file over shared primitives — deny-by-default authorization, hash-chained
audit, PII masking with audited break-glass, maker-checker approvals. I anchored on the KYC
review queue because it forces all four to be load-bearing at once.

I deliberately did **not** try to replicate two things Power Apps is genuinely good at: the
citizen-development motion, and the connector catalogue. Devin makes engineer-hours cheap; it
does not turn an ops analyst into an app author. Claiming otherwise is the fastest way to lose
a technical VP.

## Three architectural decisions

**1. Guardrails before agents.** I hand-wrote the architecture doc, schema, core contract and CI
*before* opening a session. Not for tidiness — because an agent's output quality is bounded by
what the repo can prove about it. The one control I made machine-checkable (a lint rule banning
inline role checks outside the policy module) is the one Devin respected without being asked.

**2. Interface-first, so sessions could run concurrently.** I declared the core contract up front
so two sessions could build against it simultaneously without touching each other's files. This
worked: core landed and the console bound to it with **zero edits to the console**. That is the
whole throughput argument, and it is now demonstrated rather than asserted.

**3. Masking as a structural property, not a call-site choice.** The read API applies masking
internally and takes no `unmask` parameter. An API that lets the caller opt out of masking is an
API through which PII leaks.

## Where the reasoning moved — twice

I opened believing "build, but build a framework." Research killed it. Marginal per-tool cost
comes out at **parity** with Power Apps (~$40K vs ~$39K) — only ~12% of per-tool work is
agent-compressible; the rest is requirements, security review, UAT, cutover. The premise my
architecture was organized around was wrong, and the repo now says so in `ARCHITECTURE.md §1`.

I then adopted "split the stack — own the primitives, rent the UI." A red-team pass found six
tier-1 errors in my own model, including an unjustified 3.2× maintenance penalty against the
incumbent and a recommendation whose own corrective action was never applied to its baseline.
Corrected, **split-the-stack does not break even at any tool count, discount rate, or horizon**
(P(NPV>0) = 0.0% over 20,000 draws).

So the recommendation is not a cost saving. It is a **capability purchase at ~$400K/yr**, and the
honest question for the CFO is: renting the UI alone buys ~65% of the four primitives at
~$125–145K/yr; owning the primitives underneath buys the last ~30% for ~$260–275K/yr. Is that
worth it? Sold as "saves money," it dies in the room.

## What the prototype actually measured

Two sessions, ~9 and ~7 minutes, 5,151 lines, 270 tests. The useful findings both contradict me.

**1. The verification harness proved none of the invariants it advertised.** I built the
guardrails first specifically so agent output would be safe to merge. Mutation testing says
otherwise: delete PII masking from the read path — 54/54 green. Defeat the two-person rule —
green. Delete the four-eyes gate — typecheck, lint and tests all pass. The lint rule I called
"machine-checked" is evaded five ways, including `roles.some(r => r === 'admin')`, the idiom the
repo's own policy module uses.

The confirmed critical is that two-person control counts *votes*, not *voters* — one approver
clicking twice satisfies a 2-of-2. That is the single control the architecture exists to
implement once "rather than re-derived per tool, which is where it eventually gets derived
wrong," and the one shared implementation derived it wrong.

**2. Review does not scale with lines; it scales with load-bearing claims — and reading does not
find them.** Every confirmed defect has the same shape: correct-looking code wrong in one
conjunct (`.length >= requiredApprovals`, `typeof value === 'number' &&`, `?? actorForRole(...)`).
None is visible at reading speed. Finding them took *executing mutations*, which costs far more
than the 1.3× review inflation my model assumed.

PR #1 merged **unread, 17 seconds after opening**; PR #2 got **5–10 minutes** for 2,228 lines,
roughly 1–2% of a careful review. The tax was not paid — it was skipped, invisibly, because CI
stayed green.

Worth stating: the agent-run review was itself wrong about half the time — adversarial
verification confirmed 5 findings and downgraded 9, including three of four "criticals," while
the genuine critical ranked fifth. **If your review pipeline is agent-run, budget for the
adversarial pass.**

The sharpest way I can put it: *the artifact CI produces — "54 passed" — stops carrying
information at that authorship rate, and nobody notices, because it looks identical to the
artifact it produced when it did.*

## What I'd flag

I over-ranked a finding earlier and want it on the record: I called the hardcoded session secret a
critical auth bypass. It is major, not critical — `/api/session` hands out any role for free by
design, so knowing the secret confers no incremental privilege. It stays major only because a
comment there asserts a fail-closed guarantee that does not exist, which is the exact hazard of
fluent agent prose: a confident comment gets read as evidence.

The prototype demonstrates the primitives, not the recommendation. The recommendation's technical
crux — binding a *rented* UI's queries to the end user's identity so it cannot forge or escalate —
is untested here and is the Week-2 gate of the proposed pilot. That, plus mutation testing in CI,
is where I would spend the next two hours. Not on more tools.
