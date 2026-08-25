/**
 * Public contract of @itp/core. These signatures are normative and were seeded before
 * implementation so that independent sessions could build against them in parallel.
 *
 * This file is now the barrel over the implementations in ./policy, ./audit, ./pii,
 * ./approvals and ./read. The declared shape is unchanged: every name below has the
 * signature the contract declared, so the console binds to it with no edit.
 */
import { maskRow as maskRowImpl } from './pii/index';
import type { piiColumns } from './db/schema';
import type { Actor } from './types';

export type {
  Actor,
  ApprovalRecord,
  AuditRecord,
  Decision,
  Resource,
  Role,
  ToolSpec,
} from './types';

/**
 * Thrown by any function in this package when `can()` denies. The denial is audited
 * (decision: 'deny') BEFORE this is thrown, so the audit trail records attempts, not
 * just successes.
 */
export { PolicyDeniedError } from './types';

/**
 * The single authorization choke point. Pure and total: no I/O, never throws.
 * Deny-by-default — an action with no matching rule returns { allowed: false }.
 */
export { can } from './policy/index';

/**
 * Executes `mutate` and writes its audit record in ONE transaction. If the audit
 * write fails the mutation rolls back. There is deliberately no way to mutate a
 * domain table through this package without producing an audit row.
 *
 * Denied attempts are also audited, with decision: 'deny'.
 */
export { withAudit, verifyAuditChain } from './audit/index';

/**
 * Records a refusal the policy cannot express — a domain precondition, a missing
 * justification — as a deny link on the chain, and returns the error to throw. A tool
 * that refuses an action still has to leave a trace of the attempt (§3.4), and this is
 * the only supported way for it to write one.
 */
export { auditDenial as recordDenial } from './audit/index';

/** Maker-checker. Returns the approval record; applies the action once satisfied. */
export { requestApproval, castVote } from './approvals/index';

/**
 * Reads. Every one of them masks before returning and none takes an `unmask`
 * parameter — see ./read for why that is the load-bearing property.
 */
export { listRows, getRow, listAuditRows, listApprovals, isKnownTable } from './read/index';

/**
 * `revealRow` is the audited counterpart to `getRow`: same row, unmasked, gated by
 * `pii.unmask` plus a live grant and recorded with the caller's stated reason.
 * `getApproval` resolves one pending approval so a voter can be told what they signed.
 */
export { revealRow, getApproval } from './read/index';

/**
 * Identity binding at the external API boundary (§3.8): a short-lived, HMAC-signed
 * assertion of the HUMAN's identity, minted by the session issuer and verified by
 * the data layer independently of the calling UI. Refusals are audited as denials.
 * `SERVICE_ACTOR` is the machine identity the contrast demo audits against.
 */
export {
  mintAssertion,
  verifyAssertion,
  SERVICE_ACTOR,
  ASSERTION_SECRET_ENV,
  DEFAULT_ASSERTION_TTL_SECONDS,
} from './assert/index';

/**
 * The domain write path. A tool cannot reach `withAudit`'s transaction handle from
 * outside this package, so patching a row goes through here — which means through
 * `can()` and onto the audit chain, with classified columns redacted in the diff.
 */
export { updateRow } from './write/index';
export type { RowDiff } from './write/index';

/**
 * Masks columns classified in schema.ts `piiColumns` unless the actor holds a
 * matching unmask grant. Calling with `unmask: true` emits its own audit event.
 */
export function maskRow<T extends Record<string, unknown>>(
  table: keyof typeof piiColumns,
  row: T,
  actor: Actor,
  opts?: { unmask?: boolean; reason?: string },
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
