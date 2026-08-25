/**
 * Pure view logic for the spec-driven components.
 *
 * Kept free of React and of any @itp/core runtime import so it is exhaustively
 * unit-testable, in the same spirit as ARCHITECTURE.md §3.3: the interesting
 * decisions are functions, not rendering.
 */
import type { Actor, Decision, Resource, ToolSpec } from '@itp/core';

export type Row = Record<string, unknown>;

export type CanFn = (actor: Actor, action: string, resource: Resource) => Decision;

export type FilterState = Readonly<Record<string, string>>;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  hour12: false, timeZone: 'UTC',
});

/**
 * Field-aware display formatting. Raw ISO strings and integer cents are storage
 * shapes, not operator-facing values — a fintech ops screen that shows
 * "2025-01-04T06:00:00.000Z" or "5000000" reads as a debug view.
 */
export function formatCell(field: string, value: unknown): string {
  if (typeof value === 'number' && /Cents$/.test(field)) return usd.format(value / 100);
  if (typeof value === 'string' && ISO_RE.test(value)) {
    const at = Date.parse(value);
    if (!Number.isNaN(at)) return dateFmt.format(at);
  }
  return cellText(value);
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** SLA badge state. Red when the due timestamp is in the past. */
export function slaState(dueValue: unknown, now: Date): 'breached' | 'due-soon' | 'ok' | 'none' {
  if (typeof dueValue !== 'string') return 'none';
  const due = Date.parse(dueValue);
  if (Number.isNaN(due)) return 'none';
  const msLeft = due - now.getTime();
  if (msLeft < 0) return 'breached';
  if (msLeft < 4 * 60 * 60 * 1000) return 'due-soon';
  return 'ok';
}

export function slaLabel(state: ReturnType<typeof slaState>): string {
  switch (state) {
    case 'breached':
      return 'SLA breached';
    case 'due-soon':
      return 'Due soon';
    case 'ok':
      return 'On track';
    case 'none':
      return '—';
  }
}

export function applyFilters(rows: readonly Row[], filters: FilterState): Row[] {
  const active = Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined);
  if (active.length === 0) return [...rows];
  return rows.filter((row) => active.every(([field, value]) => cellText(row[field]) === value));
}

export function sortRows(
  rows: readonly Row[],
  sort: { field: string; dir: 'asc' | 'desc' } | undefined,
): Row[] {
  const out = [...rows];
  if (!sort) return out;
  const factor = sort.dir === 'desc' ? -1 : 1;
  out.sort((a, b) => {
    const av = a[sort.field];
    const bv = b[sort.field];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
    return cellText(av).localeCompare(cellText(bv)) * factor;
  });
  return out;
}

/** Tool-supplied approval trigger, OR-ed with the spec's declared threshold. */
export type ApprovalOverride = (actionKey: string, row: Row) => boolean;

export type ResolvedAction = {
  key: string;
  label: string;
  intent: 'neutral' | 'positive' | 'destructive';
  /** 'request' when the spec requires maker-checker for this row. */
  mode: 'direct' | 'request';
  reason: string;
};

/**
 * Whether this action needs a second signature for this row.
 *
 * Fails closed on a threshold it cannot evaluate. A spec naming a field the row does
 * not carry — a rename, a typo — is a configuration error, and the safe reading of an
 * unevaluable threshold is "assume it is exceeded" rather than "assume it is not":
 * the alternative silently turns dual control off for every row.
 */
function needsApproval(action: ToolSpec['actions'][number], row: Row): boolean {
  if (!action.approval) return false;
  const threshold = action.approvalThreshold;
  if (!threshold) return true;
  if (!(threshold.field in row)) return true;
  const value = row[threshold.field];
  if (typeof value !== 'number') return true;
  return value > threshold.gt;
}

/**
 * The ActionBar contract: an action is offered only when can() allows it, and an
 * action that needs a second pair of eyes is offered as "Request approval" rather
 * than as the action itself. Denials are returned too, so the UI can explain them
 * instead of silently hiding capability.
 *
 * `requiresApproval` is the extension point for a trigger the spec model cannot
 * express (`approvalThreshold` is a single numeric `>` on one field). It can only ever
 * add an approval hop, never remove one.
 */
export function resolveActions(args: {
  spec: ToolSpec;
  row: Row;
  actor: Actor;
  resource: Resource;
  can: CanFn;
  requiresApproval?: ApprovalOverride;
}): { allowed: ResolvedAction[]; denied: Array<{ key: string; label: string; reason: string }> } {
  const allowed: ResolvedAction[] = [];
  const denied: Array<{ key: string; label: string; reason: string }> = [];

  for (const action of args.spec.actions) {
    const decision = args.can(args.actor, action.permission, args.resource);
    if (!decision.allowed) {
      denied.push({ key: action.key, label: action.label, reason: decision.reason });
      continue;
    }
    const request =
      needsApproval(action, args.row) || (args.requiresApproval?.(action.key, args.row) ?? false);
    allowed.push({
      key: action.key,
      label: request ? `Request approval: ${action.label}` : action.label,
      intent: action.intent,
      mode: request ? 'request' : 'direct',
      reason: decision.reason,
    });
  }

  return { allowed, denied };
}
