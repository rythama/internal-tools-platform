# Session 4 — refunds + feature flags (the marginal-cost proof)

**Branch:** `devin/04-refunds-and-flags` · **Depends on:** Session 3 merged

## Why this session exists
This session tests the platform's central claim: **tool #2 and #3 should cost a
spec file, not a project.** Whatever this session actually costs is the number that
goes in the client recommendation. Do not optimize it to look good — we are
measuring, and an honest bad result is more useful than a flattering one.

## Deliverables
1. `tools/refunds/spec.ts` — queue by status and amount; approve/reject; refunds
   over $500 require `refund_approver` sign-off via `approvalThreshold`. Reuse
   the existing approvals primitive; write no new approval logic.
2. `tools/feature-flags/spec.ts` — flags by environment; toggle and set rollout %;
   any `prod` change requires a second approver. Deliberately a simple tool — it
   should be nearly pure spec.
3. Tests for both threshold behaviours.

## Report in the PR description
- Lines of new code, split spec vs. custom.
- Anything you had to add to `packages/core` — **and why**. Core changes here are
  the real signal: they mean the platform was under-built, and we need to know
  whether that curve flattens or keeps going.
- Wall-clock and ACU cost for this session.

## Do not
- Do not duplicate approval or audit logic. If it does not fit, that is a core gap
  worth reporting, not routing around.
