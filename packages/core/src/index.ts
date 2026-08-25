/**
 * Public contract of @itp/core. These signatures are normative and were seeded before
 * implementation so that independent sessions could build against them in parallel.
 *
 * This file is now the barrel over the implementations in ./policy, ./audit, ./pii,
 * ./approvals and ./read. The declared shape is unchanged: every name below has the
 * signature the contract declared, so the console binds to it with no edit.
 */
import { maskRow as maskRowImpl } from './pii/index.js';
import type { piiColumns } from './db/schema.js';
import type { Actor } from './types.js';

export type {
  Actor,
  ApprovalRecord,
  AuditRecord,
  Decision,
  Resource,
  Role,
  ToolSpec,
} from './types.js';

/**
 * Thrown by any function in this package when `can()` denies. The denial is audited
 * (decision: 'deny') BEFORE this is thrown, so the audit trail records attempts, not
 * just successes.
 */
export { PolicyDeniedError } from './types.js';

/**
 * The single authorization choke point. Pure and total: no I/O, never throws.
 * Deny-by-default — an action with no matching rule returns { allowed: false }.
 */
export { can } from './policy/index.js';

/**
 * Executes `mutate` and writes its audit record in ONE transaction. If the audit
 * write fails the mutation rolls back. There is deliberately no way to mutate a
 * domain table through this package without producing an audit row.
 *
 * Denied attempts are also audited, with decision: 'deny'.
 */
export { withAudit, verifyAuditChain } from './audit/index.js';

/** Maker-checker. Returns the approval record; applies the action once satisfied. */
export { requestApproval, castVote } from './approvals/index.js';

/**
 * Reads. Every one of them masks before returning and none takes an `unmask`
 * parameter — see ./read for why that is the load-bearing property.
 */
export { listRows, getRow, listAuditRows, listApprovals } from './read/index.js';

/**
 * Masks columns classified in schema.ts `piiColumns` unless the actor holds a
 * matching unmask grant. Calling with `unmask: true` emits its own audit event.
 */
export function maskRow<T extends Record<string, unknown>>(
  table: keyof typeof piiColumns,
  row: T,
  actor: Actor,
  opts?: { unmask?: boolean },
): T {
  return maskRowImpl(table, row, actor, opts);
}

/**
 * True when this package ships a real implementation rather than declarations.
 * The console feature-detects on this rather than on the presence of `can`, so that
 * a partial implementation — mutations landed, reads not yet — is visible instead of
 * silently serving stub reads alongside real writes.
 */
export const CORE_IMPLEMENTED = true;
