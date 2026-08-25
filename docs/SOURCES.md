# Sources

*Where the numbers in this repository come from. Everything quantitative in ECONOMICS.md,
PILOT.md, KEY-DECISIONS.md, and the architecture review carries one of three provenance
classes, marked inline throughout.*

## How to read the markers

- **[V] verified** — checked against a primary source listed below during research on
  Aug 23–24, 2026. Load-bearing numeric claims were independently re-fetched and
  adversarially re-verified before use; claims that failed that pass were corrected or
  downgraded.
- **[A] assumption** — a stated estimate with a range (labor rates, build-hour scopes, agent
  leverage). These are inputs to arithmetic, not facts, and the documents present them that
  way. Derived figures (the ~$40K marginal tool cost, the ~$400K/yr capability price) inherit
  this status.
- **Measured** — produced by this repository itself and reproducible from it.

## Primary sources for the [V] claims

**Licensing and pricing**

- [Power Platform Licensing Guide, August 2026 (PDF)](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/bade/documents/products-and-services/en-us/bizapps/Power-Platform-Licensing-Guide-August-2026.pdf)
  — SKU rates (Premium $20/user/mo; unlimited apps per licensed user), Dataverse capacity
  and overage rates ($40/GB/mo database), ProDirect support, multiplexing rules.
- [Power Apps pricing](https://www.microsoft.com/en-us/power-platform/products/power-apps/pricing) ·
  [Power Automate pricing](https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing)
- [Pay-as-you-go meters](https://learn.microsoft.com/en-us/power-platform/admin/pay-as-you-go-meters)
  — $10/active user/app/month and the active-user definition (the PAYG/Premium crossover at
  2 apps/user follows arithmetically).
- [Power Apps per-app plan end of sale](https://www.microsoft.com/en-us/licensing/news/power-app-per-app-end-of-sale)
  — channel-specific carve-outs (EA true-up and CSP continue; MPSA and web-direct do not).
- [Managed Environments licensing](https://learn.microsoft.com/en-us/power-platform/admin/managed-environment-licensing)
  — premium-license requirement and the 2026 end-user compliance notifications.
- [Retool pricing](https://retool.com/pricing) — tier rates; SSO/SAML gated to Enterprise
  (fetched Aug 23, 2026).
- [Appsmith pricing](https://www.appsmith.com/pricing) — Enterprise floor $2,500/mo
  (fetched Aug 23, 2026).

**Platform limits and security model**

- [Dataverse security concepts](https://learn.microsoft.com/en-us/power-platform/admin/wp-security-cds)
  — additive-only privilege model; no explicit deny.
- [Column-level security](https://learn.microsoft.com/en-us/power-platform/admin/field-level-security)
  — statecode/statuscode, lookup, and formula columns cannot be secured.
- [API request limits](https://learn.microsoft.com/en-us/power-platform/admin/api-request-limits-allocations)
  — per-user allocations; 25,000/24h pooled tenant limit for service principals.
- [Power Automate limits](https://learn.microsoft.com/en-us/power-automate/limits-and-config)
  — 30-day max run duration (approvals included), 30-day run-history retention, 500 actions,
  25 Switch cases, 8 nesting levels.
- [Dataverse auditing](https://learn.microsoft.com/en-us/power-platform/admin/manage-dataverse-auditing) ·
  [2026 Purview change](https://learn.microsoft.com/en-us/power-platform/release-plan/2026wave1/power-platform-governance-administration/prevent-sending-sensitive-data-purview-audit-logs)
- [Canvas app YAML source](https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/power-apps-yaml)
  — read-only .pa.yaml, prior formats retired without a conversion path.
- [CoE Starter Kit](https://learn.microsoft.com/en-us/power-platform/guidance/coe/starter-kit)
  — end of investment, May 2026.
- [End of AI Builder seeded credits](https://learn.microsoft.com/en-us/ai-builder/endofaibcredits)
  — removed November 1, 2026.

**Context for the review-load findings**

- [METR, early-2025 developer study](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)
  and [2026 update](https://metr.org/blog/2026-02-24-uplift-update/) — the published evidence
  that AI-assisted speedups for experienced developers are smaller than assumed, cited as the
  reason this analysis measures leverage rather than assuming it.

## Measured in this repository

- Session wall-clocks, review minutes, corrections, and net LOC: `docs/DEVIN-WORKFLOW.md`
  (schema committed before results existed; PR timestamps independently visible on GitHub).
- Agent cost ($20.04 at the five-session checkpoint, ~$27 final): read off the Devin billing
  page, not estimated.
- Mutation results (5 controls deletable with a green suite; later 5/5 killed):
  reproducible via `npm run test:mutation` (`scripts/mutate.ts`).
- The identity-binding contrast: reproducible via `scripts/demo-contrast.sh`.

## Explicitly not verified [U]

Devin/Cognition list pricing: devin.ai/pricing returned HTTP 429 and cognition.com pricing
pages 404'd during the research pass. No rate-card figure appears anywhere in this analysis;
the only agent-cost numbers used are the measured bills above. Superblocks pricing was not
verified and is not relied on.

## Method note

Research was agent-assisted: parallel research agents fetched the sources above, and every
numeric claim carried into the analysis passed an adversarial verification pass (an
independent agent attempting to refute it against a fresh fetch). Claims that failed were
corrected or dropped; two full red-team passes over the economic model are what produced the
corrections described in KEY-DECISIONS.md. Sources reflect list pricing as of August 2026;
enterprise discounts move every implied volume, which is why the pilot's Stage 0 asks for
the client's actual invoice before any decision.
