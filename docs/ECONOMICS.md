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

### The arithmetic behind those figures [A]

**Steady-state run rate, 13 tools** (central case; people at $160/hr fully loaded, per-app
maintenance at parity on both sides):

| | Own primitives + rent UI | Optimized Power Apps |
|---|---:|---:|
| Licenses (Power Apps / Retool Enterprise) | $120K | $225K |
| Infrastructure | $70K | — |
| People (owner, on-call, deps/CVE, per-tool maintenance) | $314K | $190K |
| Security (pen test / targeted review) | $30K | $12K |
| Recurring re-certification, incidents, departure EV, OCR, ACUs, soft costs | $146K | $36K |
| **Total** | **$680K/yr** | **$463K/yr** |

Steady-state gap: **−$217K/yr ≈ −$220K/yr.** The mechanism in one line: you retire $225K of
license and replace it with $190K of infrastructure plus rented-UI license (a $35K/yr win),
then add roughly $255K/yr of labor, compliance, and operational overhead you did not
previously carry.

**One-time cost, all-in ≈ $1.25M:** primitives layer $558K (2,760 h at 1.8x leverage and a
1.3x review tax, identity-binding seam included, 25% contingency) + migrating 3 existing
tools $144K + historical Dataverse extraction with fidelity proof $170K + regulatory
re-certification $123K + training ~300 ops users $95K + hiring/ramp EV $36K + dual-run
reconciliation $54K + vendor-dependency EV $35K + OCR/IDP parity $32K.

**Cash flows and NPV** (8-tool case, $000s; year 1 carries the platform, the migrations, and
a full year of Power Apps that cannot switch off before month 9):

| | Y1 | Y2 | Y3+ |
|---|---:|---:|---:|
| Annual net vs optimized baseline | −1,300 | −190 | −225/yr |

NPV at 15% over 10 years: −1,300(0.870) − 190(0.756) − 225 × 3.39 ≈ **−$2.0M**. The
cumulative curve never turns positive, so there is no payback at any horizon.

**Equivalent annual cost:** −$2.0M ÷ 5.02 (the 10-year annuity factor at 15%) ≈
**$400K/yr**. The rent-UI-only option, priced by the same method (license + gap-closing
build + ~0.5–0.6 FTE, minus recovered spend), annualizes to **~$125–145K/yr**; the
difference, **~$260–275K/yr**, is the price of the last ~30% of capability.

The dominant input throughout is ownership headcount, not software: ±0.5 FTE moves the
equivalent-annual figure by ~$130K/yr, which is why the pilot measures ownership load
instead of assuming it. One honest cross-check the model surfaced: at 13 tools the hybrid's
*run rate* ($680K) slightly exceeds a full custom build's ($663K), because the Retool
Enterprise license costs more than the frontend ownership it displaces. The hybrid still
wins on NPV ($1.25M capex vs $1.50M) and on execution risk, but not on run rate.

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
