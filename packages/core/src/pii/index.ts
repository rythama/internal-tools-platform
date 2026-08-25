/**
 * Field-level masking driven by the schema classification (ARCHITECTURE.md §3.5).
 *
 * Masking is a property of the data-access boundary, not of the caller: the read API
 * has no `unmask` parameter, and the only way to see a classified value is to ask
 * for it explicitly here, hold a grant, and be recorded doing so.
 */
import { now } from '../clock.js';
import { db } from '../db/client.js';
import { piiColumns } from '../db/schema.js';
import { appendAudit, auditDenial } from '../audit/index.js';
import { can, hasUnmaskGrant } from '../policy/index.js';
import type { Actor } from '../types.js';

export const REDACTED = '[redacted]';

type Classification = Record<string, 'high' | 'low'>;

export function classificationFor(table: string): Classification {
  return (piiColumns as Record<string, Classification>)[table] ?? {};
}

/**
 * Masking must be idempotent. The console's adapter masks a second time on top of
 * what the read API already returned (`core-adapter/index.ts`), and a partial mask
 * applied twice would otherwise keep eating the value — `**** 4242` becoming
 * `*****4242`. An already-masked value is left alone.
 */
function isMasked(value: string): boolean {
  return value === REDACTED || value.includes('*');
}

/** `a***@example.com`, `**** 4242`, `*****cdef` — enough to recognise, not to use. */
export function partialMask(value: string): string {
  if (isMasked(value)) return value;
  const at = value.indexOf('@');
  if (at > 0) return `${value.slice(0, 1)}***${value.slice(at)}`;
  if (value.length <= 4) return `**** ${value}`;
  return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
}

/** Pure masking. No policy, no audit — used by the read API on every row it returns. */
export function maskValues<T extends Record<string, unknown>>(table: string, row: T): T {
  const classification = classificationFor(table);
  const masked: Record<string, unknown> = { ...row };
  for (const [field, level] of Object.entries(classification)) {
    const value = masked[field];
    if (typeof value !== 'string') continue;
    masked[field] = level === 'high' ? REDACTED : partialMask(value);
  }
  return masked as T;
}

/**
 * The contract's `maskRow`. Two gates guard an unmask: the policy must allow
 * `pii.unmask` for this actor, and the actor must hold an unexpired grant for this
 * resource type. Either failure is audited as a denial before it throws.
 */
export function maskRow<T extends Record<string, unknown>>(
  table: string,
  row: T,
  actor: Actor,
  opts?: { unmask?: boolean },
): T {
  if (!opts?.unmask) return maskValues(table, row);

  const resource = { type: table, id: String(row['id'] ?? 'unknown') };
  const decision = can(actor, 'pii.unmask', resource);
  if (!decision.allowed) {
    throw auditDenial({
      actor,
      action: 'pii.unmask',
      resource,
      decisionReason: decision.reason,
      diff: { fields: Object.keys(classificationFor(table)) },
    });
  }

  if (!hasUnmaskGrant(actor, table, new Date(now()))) {
    throw auditDenial({
      actor,
      action: 'pii.unmask',
      resource,
      decisionReason: `no live unmask grant for ${table}`,
      diff: { fields: Object.keys(classificationFor(table)) },
    });
  }

  // §3.5: "who looked at this customer's SSN, and when" must be a query.
  db().transaction((tx) =>
    appendAudit(tx, {
      actor,
      action: 'pii.unmask',
      resource,
      decision: 'allow',
      decisionReason: decision.reason,
      diff: { fields: Object.keys(classificationFor(table)) },
    }),
  );

  return { ...row };
}
