# Economics

*Condensed from a fuller model built during this exercise. [V] = verified against a primary
source (Microsoft's Aug 2026 licensing guide, vendor pricing pages). [A] = assumption with a
stated range. Figures rounded to the precision the inputs support. Full provenance, including
URLs for every [V] claim: [SOURCES.md](SOURCES.md).*

## Resolving the $250K

At list, $250K/yr cannot be mostly per-app licensing (implied seats exceed any plausible
headcount). The likely composition is 150–350 Premium seats with **60–75% of the bill in
Dataverse capacity, automation SKUs, and support** [A, medium confidence]. Decisive facts a
one-day report pull settles: assigned Premium seats, the Dataverse database/file/log split,
purchasing channel and EA anniversary, and actual discount off list.

Two verified anchors: Premium ($20/user/mo) grants unlimited apps per user [V] — so at high
seat counts, ten more apps are nearly free and building never pays back. Dataverse database
overage is $480/GB/yr [V] vs ~$0.28/GB/yr object storage — the ~100× multiple is how a
modest-seat tenant reaches $250K, and the most recoverable line in the bill.

## What the corrected model shows

First model favored building; a red-team pass found six load-bearing errors in it (including
an unjustified 3.2× maintenance penalty on the incumbent, and computing breakeven against a
baseline our own first recommendation would have corrected). Corrected — optimized-Power-Apps
baseline, per-app maintenance at parity, discounting, 6/8/13-tool cases, nine previously
unpriced cost lines (self-service regression, Dataverse data exit, re-certification, training,
hiring/ramp, owner-departure risk, dual-run reconciliation, vendor dependency, incident cost):

| | 6 tools | 8 tools | 13 tools |
|---|---:|---:|---:|
| Steady-state net vs optimized Power Apps | −$230K/yr | −$225K/yr | −$220K/yr |
| 10-yr NPV @ 15% | −$2.1M | −$2.0M | −$2.0M |

**The full build never breaks even at any tool count, discount rate, or horizon.** Marginal
per-tool cost is at parity with Power Apps (~$40K vs ~$39K fully loaded) because only ~12% of
per-tool work is agent-compressible; requirements, security review, UAT, and cutover are not.

## The recommendation this supports

Not a cost saving — a **capability purchase**, priced honestly:

- Rent the UI layer (Retool/Appsmith Enterprise): parity with optimized Power Apps at
  ~$125–145K/yr equivalent-annual, ~65% of the four compliance primitives.
- Own the primitives underneath (deny-by-default authz, tamper-evident audit, audited
  break-glass, enforced dual control): ~$400K/yr equivalent-annual.
- **The last ~30% of compliance capability therefore costs ~$260–275K/yr.** That is a
  legitimate budget question, and a fatal thing to mis-sell as savings.

## What the prototype measured (vs. what the model assumed)

Agent cost is noise: **~$27 measured** for ~66 min of agent time across six sessions
(~7,000 lines, 228 tests) — the model's claim that ACU spend is economically irrelevant held.
The binding constraint did not behave as modeled: review was assumed to inflate ~1.3× on
agent output; observed behavior was that review *depth fell to fit the time available*
(0 → 5–10 → 10–15 min per PR against volume warranting hours). The three real defects found
were caught by a rival agent session and an adversarial automated review — none by a human
reading a diff. Verification apparatus, not code authorship, is the real line item on either
side of build-vs-buy.

## Kill criteria (pre-registered)

Do not build if any of: ≥700 assigned Premium seats with <60GB capacity overage; no named,
funded platform owner (≥0.5 FTE + backup); measured Power Platform labor below 0.5 FTE
projected to 13 apps; a 4-week Retool/Appsmith spike delivers the KYC queue with SSO, RBAC,
audit, and masking at ≤$150K/yr all-in.
