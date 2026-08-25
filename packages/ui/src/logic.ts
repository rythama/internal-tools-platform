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

export type ResolvedAction = {
  key: string;
  label: string;
  intent: 'neutral' | 'positive' | 'destructive';
  /** 'request' when the spec requires maker-checker for this row. */
  mode: 'direct' | 'request';
  reason: string;
};

function needsApproval(action: ToolSpec['actions'][number], row: Row): boolean {
  if (!action.approval) return false;
  const threshold = action.approvalThreshold;
  if (!threshold) return true;
  const value = row[threshold.field];
  return typeof value === 'number' && value > threshold.gt;
}

/**
 * The ActionBar contract: an action is offered only when can() allows it, and an
 * action that needs a second pair of eyes is offered as "Request approval" rather
 * than as the action itself. Denials are returned too, so the UI can explain them
 * instead of silently hiding capability.
 */
export function resolveActions(args: {
  spec: ToolSpec;
  row: Row;
  actor: Actor;
  resource: Resource;
  can: CanFn;
}): { allowed: ResolvedAction[]; denied: Array<{ key: string; label: string; reason: string }> } {
  const allowed: ResolvedAction[] = [];
  const denied: Array<{ key: string; label: string; reason: string }> = [];

  for (const action of args.spec.actions) {
    const decision = args.can(args.actor, action.permission, args.resource);
    if (!decision.allowed) {
      denied.push({ key: action.key, label: action.label, reason: decision.reason });
      continue;
    }
    const request = needsApproval(action, args.row);
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
