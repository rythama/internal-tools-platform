# The Pilot

*Nine weeks, gated at week 2. Designed so the cheapest experiment that can kill the thesis
runs first, with pre-registered success and failure criteria — a pilot without a stopping
rule always succeeds.*

## What, for whom

**Refund approval and issuance for disputed transactions in the $500–$2,500 band.** Maker
(refund agent) proposes; checker (payment ops lead) approves; funds move; every step
authorized deny-by-default, masked by default, hash-chain audited, dual-controlled.
14 named users: 8 agents, 3 ops leads, finance controller, compliance analyst, platform admin.

**Not KYC**, deliberately: KYC cannot reach production inside nine weeks (SOC 2 scope,
BSA/AML documentation, sponsor-bank notification) and has no safety dial. Refunds has a
dollar cap — a continuous, auditable, instantly reversible blast-radius control. Refunds
>$2,500 stay on the incumbent throughout; tokens and last-4 only, keeping the pilot outside
PCI CDE scope.

## Sequencing and cost

- **Stage 0 (week −2, ~$3K):** pull licensing/capacity reports. Can kill everything on its own.
- **Stage 1 (weeks 1–4, ~$13K, parallel, different people):** optimize Power Apps in place —
  recovers $50–130K/yr at ~15:1 and corrects the baseline the decision is measured against.
- **Phase A (weeks 1–2, ~$30K) — the architectural gate:** a rented-UI query must carry a
  signed assertion of the *human's* identity that the data layer verifies independently
  (Postgres RLS keyed off a per-request assertion; the UI's role can only execute
  security-definer functions). If identity binding requires trusting the client, **stop at
  $30K** — the split-stack premise is false. The prototype demonstrates the API half of this
  mechanism (`packages/core/src/assert/`); RLS is exactly what this gate proves.
- **Phase B (weeks 3–9, ~$156K):** build on owned primitives, shadow production (week 6),
  live in the $500–$1,000 band (week 7), widen to $2,500 + 3-day reuse test building a
  read-only feature-flag view on the same primitives (week 8), decision readout (week 9).

All-in for the quarter ≈ $202K, of which only ~$48K is committed before the first stop gate.
If the build proceeds, 60–70% of Phase B labor capitalizes into the platform.

## Measured, not assumed

Every Devin session instrumented (schema committed to the repo empty, on day one): ACUs from
the billing export, wall-clock, human correction minutes split setup/steering/review/fixes,
correction rounds, net LOC. Plus the two numbers that decide the model: **review minutes per
100 LOC by authorship** (assumed 1.3×; falsifiable in both directions) and **whether one
engineer sustains ≥3 concurrent sessions** with <20% cross-session rework — the untested
assumption all agent-leverage claims rest on.

## Stopping rules (each independently sufficient)

Identity binding fails (wk 2) · Enterprise UI terms not secured in 10 business days (wk 2) ·
bypass only preventable by disabling UI features ops needs (wk 5) · >20% hours over with
core tests failing (wk 6) · any undetected audit tamper, any deny-expected case passing, any
maker==checker refund (wk 8 — stop the build entirely) · adoption <60% or ops asks to revert
(wk 8) · reuse <50% on the second workflow (wk 8 — stop the platform, keep the workflow) ·
**all primitives pass but payback still >6 years (wk 9): bound it — build primitives for
refunds and KYC only, funded as a compliance line; do not build tools 4–13 on it.**
