# Session 3 — KYC review queue (the anchor workflow)

**Branch:** `devin/03-kyc-review` · **Depends on:** Sessions 1 and 2 merged

## Goal
The end-to-end workflow, as a spec plus the minimum custom code it genuinely needs.
This is the tool we demo, so it must feel real, not like a scaffold.

## The workflow
1. Reviewer (`kyc_reviewer`) opens the queue, sorted by SLA breach risk.
2. Opens a case. `taxId` and `dateOfBirth` are **masked**.
3. Reviewer requests unmask with a reason → sees the value → **the unmask is audited.**
4. Reviewer approves, rejects, or escalates.
5. Approving a case with `sanctionsHit` or `riskScore >= 80` requires a second
   sign-off from `kyc_approver`, and the reviewer cannot be the approver.
6. Approver sees it in the approvals panel, signs off, case transitions.
7. Every step — including the denied attempts — is on the `/audit` chain.

## Deliverables
1. `tools/kyc-review/spec.ts` — as much of the above as the spec model expresses.
2. Custom code **only** where the spec genuinely cannot express it (the risk-based
   approval trigger, the unmask-with-reason flow). Keep it in `apps/console`.
3. Tests: the six steps above as an integration test asserting both the state
   transitions and the resulting audit rows.

**If you find yourself fighting the spec model, stop and say so in the PR.** That
tension is a finding we want to report honestly, not paper over — where the
declarative model breaks down is exactly what we need to tell the client.

## Done when
A reviewer can run the full workflow in the browser, the audit view shows every
step including denials, and CI is green.
