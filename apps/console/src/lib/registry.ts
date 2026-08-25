/**
 * Tool registry: the specs this deployment hosts, filtered for the current actor.
 *
 * Visibility is a policy decision, not a UI one — the spec's `visibleTo` is passed to
 * can() as a resource attribute so the role intersection happens inside the policy
 * module (§3.3), and the denial is auditable like any other.
 */
import type { Actor, ToolSpec } from '../core-adapter/index';
import { can } from '../core-adapter/index';
import { specs as registeredSpecs } from '../../../../tools/index';

/**
 * The specs this deployment hosts. There is no demo fallback any more: the shell used
 * to synthesise a generic spec over an in-memory table when the registry was empty,
 * which was right while no tool existed and is wrong now that one does — an empty
 * registry should look empty.
 */
export function allSpecs(): readonly ToolSpec[] {
  return registeredSpecs;
}

export function visibleSpecs(actor: Actor): readonly ToolSpec[] {
  return allSpecs().filter((spec) => canViewTool(actor, spec).allowed);
}

export function canViewTool(actor: Actor, spec: ToolSpec) {
  return can(actor, 'tool.view', {
    type: 'tool',
    id: spec.key,
    attrs: { visibleTo: spec.visibleTo },
  });
}

export function findSpec(key: string): ToolSpec | undefined {
  return allSpecs().find((spec) => spec.key === key);
}

/** Reverse lookup for the approval routes, which know a resource type, not a tool. */
export function specForTable(table: string): ToolSpec | undefined {
  return allSpecs().find((spec) => spec.queue.table === table);
}
