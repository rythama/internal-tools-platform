/**
 * Tool registry: the specs this deployment hosts, filtered for the current actor.
 *
 * Visibility is a policy decision, not a UI one — the spec's `visibleTo` is passed to
 * can() as a resource attribute so the role intersection happens inside the policy
 * module (§3.3), and the denial is auditable like any other.
 */
import type { Actor, ToolSpec } from '../core-adapter/index';
import { can, coreIsImplemented } from '../core-adapter/index';
import { demoSpec, installDemoFixtures } from '../core-adapter/fixtures';
import { specs as registeredSpecs } from '../../../../tools/index';

export function allSpecs(): readonly ToolSpec[] {
  if (registeredSpecs.length > 0) return registeredSpecs;
  installDemoFixtures();
  return [demoSpec];
}

export function usingDemoSpec(): boolean {
  return registeredSpecs.length === 0;
}

export function shellIsStubbed(): boolean {
  return !coreIsImplemented || usingDemoSpec();
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
