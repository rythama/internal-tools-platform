import type { Actor, Resource, ToolSpec } from '@itp/core';
import { resolveActions, type ApprovalOverride, type CanFn, type Row } from './logic';

export type ActionBarProps = {
  spec: ToolSpec;
  row: Row;
  actor: Actor;
  resource: Resource;
  can: CanFn;
  /** POST target. The handler re-checks can() server-side; this bar is UI only. */
  endpoint: string;
  /** Tool-supplied approval trigger for rules the spec model cannot express. */
  requiresApproval?: ApprovalOverride;
};

/**
 * Renders only the actions can() allows, and renders an action that needs a second
 * signature as "Request approval: …" rather than as the action itself (§3.6).
 *
 * Denied actions are listed, greyed out, with the reason from the Decision. Hiding
 * them entirely trains operators to file tickets asking why a button is missing;
 * showing the reason makes the policy legible.
 */
export function ActionBar({ spec, row, actor, resource, can, endpoint, requiresApproval }: ActionBarProps) {
  const { allowed, denied } = resolveActions({
    spec,
    row,
    actor,
    resource,
    can,
    ...(requiresApproval ? { requiresApproval } : {}),
  });

  return (
    <form className="action-bar" method="post" action={endpoint}>
      <input type="hidden" name="resourceId" value={resource.id} />
      {allowed.map((action) => (
        <button
          key={action.key}
          type="submit"
          name="action"
          value={action.key}
          className={`btn btn-${action.intent}${action.mode === 'request' ? ' btn-request' : ''}`}
          title={action.reason}
        >
          {action.label}
        </button>
      ))}
      {allowed.length === 0 ? <span className="muted">No actions available to you here.</span> : null}
      {denied.length > 0 ? (
        <ul className="denied-actions">
          {denied.map((action) => (
            <li key={action.key}>
              <span className="btn btn-disabled" aria-disabled="true">
                {action.label}
              </span>
              <span className="muted">{action.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
