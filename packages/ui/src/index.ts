/**
 * @itp/ui — spec-driven presentation primitives.
 *
 * These components never touch the database and never make an authorization
 * decision: they take rows as the data-access layer returned them (already masked)
 * and a `can` function, and render what it permits.
 */
export { Queue, SlaBadge, type QueueProps } from './queue';
export { Detail, type DetailProps } from './detail';
export { ActionBar, type ActionBarProps } from './action-bar';
export {
  ApprovalPanel,
  type ApprovalPanelProps,
  type ApprovalView,
  type ApprovalVoteView,
} from './approval-panel';
export { AuditChain, type AuditChainProps, type AuditRowView } from './audit-chain';
export {
  applyFilters,
  cellText,
  resolveActions,
  slaLabel,
  slaState,
  sortRows,
  type CanFn,
  type FilterState,
  type ResolvedAction,
  type Row,
} from './logic';
