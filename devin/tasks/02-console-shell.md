# Session 2 — console shell (@itp/console, @itp/ui)

**Branch:** `devin/02-console-shell` · **Runs:** in parallel with Session 1

Build against the *declared* contract in `packages/core/src/index.ts`. Session 1 is
implementing it concurrently — import the types, stub the runtime behind a thin
local adapter if needed, and do not edit files under `packages/core/`.

## Goal
The generic shell that renders any `ToolSpec`. No KYC-specific code in this session.

## Deliverables
1. Dev session stub: signed cookie carrying `{ sub, email, roles[] }`, plus a role
   switcher in the header so a reviewer can demo permission differences live.
   Shape it exactly like an OIDC claim set (§3.2).
2. Tool registry: discovers `tools/*/spec.ts`, filters by `visibleTo` against the
   current actor, renders the console nav.
3. `@itp/ui` spec-driven components:
   - `<Queue>` — columns, filters, sort, SLA badge (red when `dueField` is past).
   - `<Detail>` — sectioned field layout, renders masked values as returned.
   - `<ActionBar>` — renders only actions where `can()` allows; an action requiring
     approval renders as "Request approval", not as the action itself.
   - `<ApprovalPanel>` — pending approvals with approve/reject and the vote trail.
4. Route `/t/[tool]` and `/t/[tool]/[id]` driven entirely by the spec.
5. An `/audit` view: the chain, newest first, with a green/red chain-integrity banner.

## Design constraints
Plain CSS or CSS modules. No component library, no Tailwind config to bikeshed.
Dense, legible, keyboard-navigable — this is an operator tool, not a marketing page.
Aim for something an ops team would use for six hours a day.

## Do not
- Do not implement business logic for any specific tool.
- Do not call the database directly from a component. All access goes through `@itp/core`.
- Do not gate UI on `role === '...'` — call `can()`. Lint will fail you (§3.3).

## Done when
The console renders a spec end-to-end against seeded data, and CI is green.
