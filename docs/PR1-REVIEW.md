# Code review — PR #1 (`devin/02-console-shell`), merged as `0739646`

*Scope note: this write-up covers the three review lenses delivered with adversarial verification (authorization/session, architecture conformance, test quality). Two of the five lenses did not return. Every severity below is the **adversarially corrected** severity, not the first-pass one. All claims re-verified against a clean tree at `559cdbd`; suite is 54/54 green, `git status` clean.*

---

## 1. Verdict on the merge

**It was not fine, and it was also not a disaster. Both halves matter.**

PR #1 was merged 17 seconds after it opened — 2,933 lines, unread, on the strength of a green CI. The honest finding is that green CI could not have told you anything, and that is what got through.

**Nothing merged is exploitable today.** There is no database, no deployment, one demo table, and zero registered tool specs (`tools/index.ts` is `export const specs: readonly ToolSpec[] = []`). Every action's effect is literally `mutate: () => undefined` (`apps/console/src/app/api/t/[tool]/[id]/action/route.ts:54,81`). No money moves, no PII exists, no regulator sees anything. Anyone reporting this PR as a live security incident is wrong.

**But three things got through that reading would have caught, and all three survive the prototype:**

1. **The two-person rule counts votes, not voters.** `apps/console/src/core-adapter/stub-runtime.ts:280` compares `approval.votes.filter(v => v.vote === 'approve').length` against `requiredApprovals`. Nothing deduplicates by `voterSub`. One approver clicking Approve twice satisfies a 2-of-2. This is the single control ARCHITECTURE §3.6 exists to implement *once* "rather than re-derived per tool, which is where it eventually gets derived wrong" — and the one shared implementation derives it wrong. It is latent only because the demo spec happens to use `requiredApprovals: 1`, where `>= N` and `>= 1` agree.

2. **The verification harness proves none of the invariants it is advertised to prove.** Mutation testing (independently reproduced): delete PII masking from the read path — 54/54 green. Change the vote threshold to `>= 1` — 54/54 green. Delete the four-eyes gate on the vote button *and* its import — typecheck, lint, and tests all pass. `registry.test.ts:11`, one of the 54, executes zero assertions (its loop iterates over `tools/*/spec.ts`, of which there are none). The one lint rule ARCHITECTURE §3.3 calls "machine-checked rather than aspirational" is evaded by five different idioms — I ran ESLint against a probe file containing `roles.some(r => r === 'admin')`, destructured `roles`, reversed operands, `.indexOf`, and computed `['roles']` access: **zero errors, exit 0**. The `.some()` form is the idiom `policy-stub.ts:45` itself models.

3. **The severity picture the first-pass reviewers produced was itself wrong.** Three separate lenses independently rated the session-secret fallback and the `currentActor()` fail-open as *critical*, and all three missed that `apps/console/src/app/api/session/route.ts:11-23` is an unauthenticated POST that mints a validly-signed cookie for any role you name. Forging the secret buys strictly less than the front door already gives away. That is the documented dev role-switcher (§3.2, README known gaps), so it is not a defect — but it means the reviewers ranked three documented prototype gaps above the one genuine critical.

**The process failure is real independent of the outcome.** A merge that is fine by luck is not a control. What made it fine was the absence of a database, not the presence of a review.

---

## 2. Blocking items for session 1

Commit `90f3984` already fixed four contract errors found post-merge (read API, `PolicyDeniedError`, `requestApproval.permission`, `CORE_IMPLEMENTED`). The following are the **remaining** deltas. Do these before session 1 runs.

### 2a. `packages/core/src/index.ts` — contract changes

**(1) `AuditRecord` is missing two columns the schema declares `notNull`.**
`packages/core/src/db/schema.ts:26,29` declares `actorSub` and `actorRoles` (with the rationale "*Roles held at time of action — not looked up later, since roles change*"). `AuditRecord` in the contract declares neither, and the stub's `appendAudit` (`stub-runtime.ts:145-155`) emits neither. Session 1 implementing to `AuditRecord` will either violate `notNull` or ship an audit log that cannot answer "was this person entitled at the time" — the first question in any access review. Because the fields are absent they are also outside the hash, so backfilling later breaks the chain.

```ts
export interface AuditRecord {
  seq: number;
  occurredAt: string;
  /** Stable subject identifier. actorEmail is mutable and must not be the only identity. */
  actorSub: string;
  actorEmail: string;
  /** Roles held at the time of the action, captured — never looked up later. */
  actorRoles: readonly Role[];
  action: string;
  // ... unchanged
}
```

**(2) `castVote` has no stated distinct-voter or terminal-state semantics.** Add them normatively, so session 1 cannot reproduce `stub-runtime.ts:280`:

```ts
/**
 * Records one vote. NORMATIVE:
 *  - Satisfaction counts DISTINCT voterSub values, not vote rows. A voter who has
 *    already voted on this approval is refused (PolicyDeniedError), not counted twice.
 *  - Only an approval in state 'pending' accepts a vote. 'rejected', 'applied' and
 *    'expired' are terminal; a vote against a terminal approval is refused and audited.
 *  - Applying a satisfied approval is idempotent.
 */
export declare function castVote(args: {
  actor: Actor;
  approvalId: number;
  vote: 'approve' | 'reject';
  note?: string;
}): { state: 'pending' | 'approved' | 'rejected' | 'applied' };
```

**(3) The console cannot ask core "may this actor vote?", so it asks the stub — and the stub fails open.** `apps/console/src/core-adapter/index.ts:120` calls `stubSelfApprovalBlocked(...)` with **no** `runtime.` feature-detect, in a file where all ten other bindings have one. When real core lands, `listApprovals` returns core's records, the stub store is empty, the lookup returns `false`, and the requester is shown a live Approve button on their own request. Verified by execution against a mocked real core: `canVoteOn(requester) = { allowed: true }`. The reason it has no feature-detect is that **the contract declares nothing to detect**. Fix the contract, then the adapter:

```ts
export interface ApprovalRecord {
  // ... existing fields
  /** Four-eyes flag as recorded at request time. Callers must not re-derive it. */
  disallowSelfApproval: boolean;
}
```

That is the minimal fix (`canVoteOn` then derives from `requestedBy` + `disallowSelfApproval`, both on the record). If you prefer core to own the whole answer, add instead:

```ts
/** Whether this actor may cast a vote on this approval. Reads state; never throws. */
export declare function canVote(actor: Actor, approvalId: number): Decision;
```

**(4) `tool.view` must be specified as fail-closed on a missing attribute.** `policy-stub.ts:57-62` only denies when `visibleTo` is *present and an array*; absent `attrs` falls through to the generic operator allow rule. Add to the `can()` docblock:

```ts
/**
 * ... deny-by-default ...
 * NORMATIVE: for action 'tool.view', a resource that does not carry an
 * `attrs.visibleTo` array is DENIED. Absence of the attribute is a denial, never
 * a pass — otherwise a caller that forgets the attribute opens every tool.
 */
```

**(5) `maskRow` must fail closed on an unclassified table.** Its `table` parameter is typed `keyof piiColumns`, but the console passes a plain string from a spec (`core-adapter/index.ts:70-79` casts it), and `demo_records` is not in `piiColumns` at all. Specify:

```ts
/**
 * ... NORMATIVE: a table absent from `piiColumns` is an error, not an empty
 * classification. Throw, or mask every string column — never return clear text
 * for a table nobody classified.
 */
```

**(6) `approvalThreshold.field` is an unchecked string.** `packages/core/src/index.ts:115` is `approvalThreshold?: { field: string; gt: number }`, with no linkage to `schema.ts:102 amountCents`. §3.7 promises "*a column rename breaks the build instead of breaking production at 2am*"; it does not. Combined with `packages/ui/src/logic.ts:83` (see §3, finding 3) a typo silently removes approval. At minimum add the normative rule; ideally parameterize `ToolSpec` over its row type so `field` is `keyof Row`:

```ts
    /**
     * Only require approval above a threshold, e.g. refunds > $500.
     * NORMATIVE: if the named field is absent or non-numeric on the row, the
     * action REQUIRES approval. An unevaluable threshold is never a waiver.
     */
    approvalThreshold?: { field: string; gt: number };
```

**(7) Read APIs must return storage-isolated records.** `stubListAuditRows()` returns a shallow copy — `stubListAuditRows()[0].action = 'x'` rewrites the store (verified). Add to the read-API docblock: *"Returned records are structurally isolated from storage; mutating a returned object must not affect the log."*

### 2b. `devin/tasks/01-core-primitives.md` — task changes

**Remove the contradiction that will block the session.** The task says *"Do not edit `apps/console/` or `packages/ui/`"* and separately *"the console feature-detects on `CORE_IMPLEMENTED`."* It does not — `core-adapter/index.ts:55` is still `typeof runtime.can === 'function'`. Session 1 will land `can()` first (it is the first and easiest primitive), at which point the banner switches off and asserts "real core" while `withAudit`, `castVote`, and every read are still the stub. **Fix the adapter yourself before session 1 starts** (three lines: bind on `runtime.CORE_IMPLEMENTED === true`, all-or-nothing), then amend the task to say the adapter was already updated and still must not be edited.

**Add these acceptance tests** (each corresponds to a mutation that currently survives with a green suite):

- Approvals: `requiredApprovals: 2` — first checker approves → `pending`; a **different** checker approves → `applied`; the **same** checker voting twice → refused, and does not satisfy N=2.
- Approvals: a vote against a `rejected` or `applied` approval is refused. (Verified today: reject → `rejected`, then approve → `applied`. A rejected refund is resurrected by one further click.)
- Policy: the matrix is the **full cross product** of `Role × Action`, generated from the union types, so adding a role or action fails to compile until classified. The current matrix asserts 16 of 49; `record.purge` — the only destructive action — has exactly one row, an *allow* for admin, and no deny row for the six roles that must not purge.
- Policy: settle the admin wildcard. `policy-stub.ts:21` grants `admin: ['*']`, so `can(admin, 'record.exfiltrate')` is `allowed`. The test named "denies an unknown action **for every role**" (`policy-stub.test.ts:39`) loops over three of seven roles and omits admin — it is scoped around the one role that violates the invariant it names. Either drop the wildcard for an enumerated list, or assert the exception explicitly.
- Policy: `can(actor, 'tool.view', { type: 'tool', id: 'x' })` with **no** `attrs` is denied.
- Read API: assert masking **through `listRows`/`getRow`**, on the serialized payload — not through `maskRow` directly. The current PII test exercises the function the boundary can simply stop calling.
- Audit: the emitted row's key set equals the `auditLog` column set. (This assertion fails PR #1 today.)
- Audit: splice a row out of the middle → verifier reports the seq after the hole; swap two adjacent rows → reports the earlier seq. Current tests only mutate a field in place, which the hash recomputation catches alone; removing the `prevHash` linkage check from `stubVerifyAuditChain` leaves 54/54 green.

### 2c. Console-side fixes — not session 1's job, but blocking session 3

- `api/t/[tool]/[id]/action/route.ts:25` — add the `canViewTool` gate the read routes have (finding 2 below).
- `packages/ui/src/logic.ts:83` — one-line fail-closed inversion (finding 3).
- `eslint.config.js:22-33` — replace name-and-shape selectors with a property-name selector plus an `ObjectPattern` selector, and commit a fixture of known-bad snippets asserted to error. An unverified lint rule is the same category of unfalsifiable claim it was written to prevent.

---

## 3. Confirmed findings, ranked

### CRITICAL

**1. Two-person control is satisfied by one person voting twice**
`apps/console/src/core-adapter/stub-runtime.ts:280`

```ts
} else if (approval.votes.filter((vote) => vote.vote === 'approve').length >= approval.requiredApprovals) {
```

Votes are pushed unconditionally at :272 with no dedupe on `voterSub`; the only identity check in `stubCastVote` is the requester self-approval guard at :251. **Failure scenario:** a refund spec declares `requiredApprovals: 2, disallowSelfApproval: true`. Maker requests. Checker approves — state stays `pending`, so `ApprovalPanel` (`approval-panel.tsx:68`) re-renders the Approve form, and `canVoteOn` re-authorizes the same actor with the reason *"checker roles may sign off on someone else's request."* The same person clicks Approve again; state becomes `applied`; the panel reports "2 of 2 approvals." One human signed a control that reports itself satisfied by two. Verified by execution: `requiredApprovals: 2`, approve votes 2, **distinct voters 1**.

Latent today only because the demo spec uses `requiredApprovals: 1`. `devin/tasks/04` routes the next session straight into N=2.

### MAJOR

**2. The mutation endpoint never checks tool visibility**
`apps/console/src/app/api/t/[tool]/[id]/action/route.ts:25`

`findSpec` searches `allSpecs()` (`registry.ts:39-41`), not `visibleSpecs()`, and the route never calls `canViewTool` — while both read routes do (`t/[tool]/page.tsx:22`, `t/[tool]/[id]/page.tsx:20`). The resource built at :34 is `{ type: spec.queue.table, id }`, carrying no tool identity, so `tool.view` is structurally unconsultable on the write path. **Verified by execution:** a signed `refund_agent` session (excluded from `demoSpec.visibleTo`) gets a "Denied" page at `/t/demo-records`, then POSTs `action=triage` to the API and receives 303 + an audit row `{actorEmail: "raj.agent@example.com", action: "record.review", decision: "allow"}`. Two of seven shipped roles reach this. Survives session 1 unchanged, because a real `can()` would still be handed a tool-less resource.

**3. `approvalThreshold` fails open when the field name doesn't match the row**
`packages/ui/src/logic.ts:83` — `return typeof value === 'number' && value > threshold.gt;`

A missing, null, or string-typed value returns `false` = *no approval required*, and the server re-resolves through the **same function** (`route.ts:41`), so the approval hop is skipped server-side, not just in the UI. **Verified:** spec `{ field: 'amount', gt: 500 }` against row `{ amountCents: 500000 }` resolves to `mode: 'direct'`. A $5,000 refund executes with one pair of eyes. Note that §3.1 plans a Postgres swap, where `numeric` columns arrive from node-postgres as **strings** — a correctly-named field then fails open too. No type error, no test, no log.

**4. The four-eyes gate on the vote button has no feature-detect and fails open on session 1's landing**
`apps/console/src/core-adapter/index.ts:120` — described in §2a(3). Deleting the gate entirely passes typecheck, lint, and all 54 tests. Server-side `castVote` still refuses, so this is a control-surface defect rather than a bypassed control — but it breaks at exactly the integration event this whole repo is built around.

**5. Split-brain binding: the adapter feature-detects on `can`, not `CORE_IMPLEMENTED`**
`apps/console/src/core-adapter/index.ts:55,57-63`

Verified by execution with a mock core exporting only a real `can`: `coreIsImplemented = true`, `withAudit` still the stub, and a request the real policy **denies** produces an audit row reading `decision: "allow"` with the stub's reason string, before the real denial is thrown. Contradicts `packages/core/src/index.ts:40` ("*Denied attempts are also audited, with `decision: 'deny'`*"). The uncovered path is `api/approvals/vote/route.ts`, which performs no `can()` of its own and does mutate state. The contract already names the correct gate; the adapter ignores it.

**6. PII masking is deletable from the read path with a 100% green suite**
`apps/console/src/core-adapter/index.ts:82-90`

Verified end-to-end: replace line 84 with `return rows;` and line 89 with `return row;`, and all three CI gates pass. Rendering the real detail page under the mutation emits the raw `contactEmail` and raw `reference`; the control run emits `c***@example.com` and `[redacted]`. No test file imports `core-adapter/index.ts`. The one PII test exercises `stubMaskRow` directly — the function this boundary can simply stop calling. The masking itself is **correct**; what is missing is the regression guard on the property the contract calls load-bearing.

**7. `currentActor()` fails open, and the fallback survives the documented OIDC swap**
`apps/console/src/lib/actor.ts:8` — `return decodeSession(...) ?? actorForRole(DEFAULT_ROLE);`

Verified: an empty cookie jar, garbage, and a forged-signature admin payload all collapse to `rina.reviewer@example.com`; a cookie-less POST writes an `allow` audit row naming that employee, and `stubVerifyAuditChain` reports `ok: true`. An intact chain certifying a false attribution is worse than a broken one. *This is not the app's security hole* — `/api/session` hands out any role for free by design (§3.2). It matters because `session.ts:6` says the OIDC swap "replaces **this file and nothing else**," and `actor.ts` is not that file. Follow the migration plan and the `??` survives intact behind a real IdP.

**8. Route-level mode selection is entirely uncovered**
`apps/console/src/app/api/t/[tool]/[id]/action/route.ts:41`

Correction to the first-pass claim: forcing `resolved` to a hardcoded allow does **not** bypass authorization — `stubWithAudit:173-183` re-checks and denies (verified: 303 with `decision: "deny"` audited). What *is* unbackstopped is the `mode` choice. Force `direct` and the maker-checker hop vanishes with an `allow` row and no approval record. Force `request` and you reach `stubRequestApproval`, which by its own comment (`:213-216`) deliberately performs **no** `can()` — line 41 is the sole gate. Both mutations leave the suite green. No test imports any route or page.

**9. The session-secret comment asserts a guarantee that exists nowhere**
`apps/console/src/lib/session.ts:14-15`

```ts
/** Dev-only fallback. A real deployment fails closed instead of defaulting. */
const SECRET = process.env['SESSION_SECRET'] ?? 'dev-only-insecure-session-secret';
```

`grep -rn SESSION_SECRET` across the repo returns exactly one hit — this line. No `.env.example`, no README mention, no CI check, no `NODE_ENV` gating anywhere in the repo. The exploit is re-typed at `session.test.ts:34`. **Rated major, not critical**, because knowing the secret confers zero incremental privilege over the role switcher — and one lens argued minor on those grounds. It stays major because §3.2 designates this file as the single swap point for Okta/Entra, so it is precisely the file a later session reads while wiring real identity, and the comment tells that reader the fail-closed case is handled. This is the failure §4 names by name: *plausible-but-wrong, which survives skimming*.

### MINOR

**10. The lint rule §3.3 calls "machine-checked" is evaded five ways** — `eslint.config.js:22-33`. Confirmed by running ESLint: `roles.some(r => r === 'admin')`, destructured `const { roles }`, `'admin' === user.role`, `.indexOf`, and `actor['roles']` all produce **zero errors**. Selector 3 is bound to the literal identifier `actor`, so renaming to `user` defeats it. The `.some()` form needs no cleverness — it is the idiom `policy-stub.ts:45` models.

**11. `registry.test.ts:11` executes zero assertions** — `find tools -type f` returns only `index.ts`, so `specDirs` is `[]` and the loop body never runs. It is counted in the 54. `tools/index.ts:8` advertises this test as the safety net against an unregistered spec.

**12. `registry.test.ts:48` asserts an invariant the policy does not have** — `visibleSpecs(admin)` equals `allSpecs()` only because the demo fixture lists admin. `policy-stub.ts:57-62` runs the `visibleTo` intersection *before* the wildcard, so the first real spec whose `visibleTo` omits admin turns this red on a PR that changed nothing.

**13. `tool.view` falls through to allow when `attrs` is absent** — `policy-stub.ts:57`. Latent (the sole caller passes attrs), but it inverts deny-by-default for the most security-relevant action.

**14. Stub policy rules are resource-blind** — `policy-stub.ts:44`. `matches()` takes no `resource`. Rated minor, not major: there is exactly one table in the deployment, the contract uses tool-namespaced permissions (`'kyc.approve'`), and this file is deleted when core lands. What survives is that `policy-stub.test.ts:11` uses one shared `record` for all 16 rows, so the matrix would not catch a resource-blind real `can()` either.

**15. PII classification comes from a defaulted `seedStubTable` argument, not `piiColumns`** — `stub-runtime.ts:78,99`. `piiColumns` is imported by nothing. Downgraded from critical: no shipped call site omits the map, and `demo_records` isn't in `piiColumns` anyway, so the seed map is *more* protective than the source it bypasses. Make the parameter required.

**16. Unmask grant scoping is never asserted** — `stub-runtime.test.ts:86`. The fixture uses year 2999 and a matching `resourceType`, so both conjuncts of the `:101` predicate are always true. Replacing the whole predicate with `() => true` fails nothing. The implementation is correct; the box around the time-box is untested.

**17. `withAudit` mutates before it audits, with no rollback** — `stub-runtime.ts:184-186`. The header is honest that atomicity degrades without a database, but the degraded form chosen is exactly the shape §3.4 rules out, and it is the reference session 1 will read.

**18. Audit `diff` and approval `payload` are stored verbatim** — `stub-runtime.ts:154,223`, against `schema.ts:36` ("*PII values are stored hashed, never in clear*"). Harmless today (the console only ever passes `{ action }`), but the first tool submitting form fields writes them in clear into the one table with no DELETE path.

**19. Both ESLint exemptions disable the whole rule**, not the three role selectors — `eslint.config.js:41,60`. Equivalent today; stops being equivalent the moment a fourth restriction is added.

---

## 4. What this says about agent-authored code at a regulated company

**The claim under test:** review is the binding constraint, and it inflates roughly 1.3× on agent output. What actually happened here is more interesting than either "the agent is unsafe" or "the guardrails held."

**Review cost does not scale with lines — it scales with load-bearing claims, and those took execution, not reading.** 2,933 lines produced maybe a dozen places where a security invariant is asserted. Every single confirmed defect has the same shape: correct-looking code that is wrong in one conjunct. `.length >= approval.requiredApprovals` on an array of votes. `typeof value === 'number' &&`. `Array.isArray(visibleTo) &&`. `decodeSession(...) ?? actorForRole(DEFAULT_ROLE)`. None of these is visible at reading speed by anyone, and none was caught by 54 tests, a typechecker, or a lint rule written specifically to catch this class. Finding them required mutating the source and re-running — a method that costs far more than 1.3× reading, and is the only method that worked. The three lenses that merely *read* carefully still produced a ranking with the real critical below three non-defects.

**The first-pass review was itself wrong about half the time, and that is the load-bearing datum.** Of the findings delivered, adversarial verification confirmed 5 at stated severity and downgraded 9 — including three of the four "criticals," all of which described the documented prototype posture rather than a defect. Two separate lenses reached opposite verdicts (major vs. minor) on the same file. Meanwhile the genuine critical — the vote counter — was ranked fifth. **If your review pipeline is itself agent-run, you need the adversarial pass, and you need to budget for it.** A stack of confident, execution-backed, wrong-severity findings is worse than none, because it burns the reviewer's attention on the wrong four files.

**Did the agent's own PR-body disclosures do part of the reviewer's job? Genuinely yes — and it does not lower the estimate.** The agent disclosed both lint exemptions by name rather than rewriting expressions to slip past the selectors, and it volunteered, unprompted, that the lint rule is weaker than its author claimed. That is real and it saved real time: it means the map of *intentional* deviations can be trusted, so review can skip the "is this sneaky?" question entirely.

But measure what the disclosure covered. It flagged one lint bypass; I confirmed that one and found four more it did not mention, all of which produce zero errors, one of which is the idiom the repo's own policy module uses. And **not one of the nineteen findings above was disclosed.** Self-disclosure biases toward what the agent reasoned about explicitly; defects live in what it did not reason about. So disclosure reduces the *audit* cost — verifying that the agent did what it said — without touching the *verification* cost of proving the code does what the code says. Those are different budgets, and only the second one has compliance consequences.

**The honest reframing of 1.3×:** it may be roughly right per unit of *claimed scope*, and badly wrong per unit of *elapsed time*. A human writing 300 lines a day writes wrong code too, but slowly enough that review keeps pace and the reviewer shares the author's context. Session 2 produced ten human-days of code in 9m40s with zero corrections and a green CI, and the reviewer has none of that context. The 17-second merge is not a story about one careless click; it is the arithmetic working out exactly as you'd predict. **At a regulated company the constraint is not review capacity in hours — it is that the artifact CI produces ("54 passed") stops carrying information at that authorship rate, and nobody notices, because it looks identical to the artifact it produced when it did.**

**The counterweight, which is real:** the agent found four design errors in the *human-authored* contract — no read API, the `action`/`permission` vocabulary mismatch, `withAudit` having no denial channel, and filesystem spec discovery a bundler cannot do. All four were errors in the seed, authored before any session ran, and all four are now fixed in `90f3984`. Error-finding is not one-directional. The guardrails constrained the agent; they did not make the human right.

**For the build-vs-buy question specifically:** what this exercise actually priced is not "can an agent build the console" — it plainly can, in ten minutes, to a standard a competent engineer would recognize. It priced the *verification apparatus*, and that is the part nobody budgets for. The apparatus this repo shipped — 54 tests, a custom lint rule, a CI gate, a hash-chained audit log — is more than most teams build, was built deliberately in advance, and still could not detect a deleted PII boundary, a defeated two-person rule, or a removed four-eyes gate. Buying does not remove that cost; it relocates it to vendor assurance. Building means owning it. Either way it is the line item, not the code.

---

## 5. What the agent got right

Stated with evidence, because it is a lot.

- **The hardest architectural rule held.** `grep` for `drizzle`/`better-sqlite3` across `apps/console/src` and `packages/ui/src` returns nothing. Every read goes through `core-adapter`. That is the rule most likely to break first under time pressure, and it did not bend once in 2,933 lines.

- **It did not trust the client.** `route.ts:40` — *"Re-resolve server-side: the button the browser posted is a hint, not an authority"* — and it means it: the posted key is looked up in the spec and re-authorized. Nothing about that was required to make the demo work.

- **`can()` is genuinely consulted, and mutation testing proves it.** Stubbing `canViewTool`'s call to `can()` fails `registry.test.ts:25`. Hardcoding an allow inside `resolveActions` fails `logic.test.ts:82` *and* `components.test.tsx`. Mutating `stubCan`'s deny-by-default return fails 8 tests. Three enforcement points are covered by tests that actually kill mutants.

- **`withAudit` is a real choke point.** There is no path to mutate without producing an audit row, denials are audited with `decision: 'deny'` before the throw, and the deny row is asserted at `stub-runtime.test.ts:57,107`. Verified: a `record.purge` POST as `kyc_reviewer` is refused and audited as denied.

- **The hash chain works.** Tamper with any row and `stubVerifyAuditChain` reports the correct broken seq. Canonical JSON sorts keys. The linkage clause is present (even if untested).

- **Masking is applied at the right boundary, unconditionally, on every read path.** The control is correct — `listRows`/`getRow` mask before returning, no call site can opt out, and the components document that they receive already-masked rows. What is missing is the test, not the behavior.

- **The policy stub is the shape §3.3 asks for**: rules as data rather than a chain of `if`s, pure and total, every decision carrying a reason, tested for totality, tool visibility pushed into the policy module as a resource attribute rather than decided in the console.

- **The stub banner.** Unprompted, on the reasoning that a demo which silently looks finished is how a prototype becomes a product. That is a judgment call about human factors, made by an agent, correctly.

- **The disclosures.** Two narrowly-scoped, individually-justified lint exemptions, both named in the PR body rather than worked around — and a volunteered correction that the guardrail is weaker than its author claimed. The exemption *files* are exactly the two that legitimately touch the claim set.

- **Four errors found in the human-authored contract**, all real, all now fixed.

The comments throughout are unusually good — they explain *why*, not *what*, and several are precisely the note the next reader needs. The one place that backfires is `session.ts:14`, where a comment asserts a safety property the next line contradicts. That is worth naming not as sloppiness but as the specific hazard of high-quality agent prose: a confident, well-written comment is read as evidence, and here it was the only evidence.