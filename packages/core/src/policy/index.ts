/**
 * The single authorization choke point (ARCHITECTURE.md §3.3).
 *
 * This module and this module only reasons about roles; the lint config enforces
 * that everywhere else. `can()` is pure and total: no I/O, no throwing, no clock.
 */
import type { Actor, Decision, Resource, Role } from '../types.js';
import { ALLOW_RULES, type Rule } from './rules.js';

export { ACTIONS, ALLOW_RULES, REFUND_SELF_SERVICE_LIMIT_CENTS, ROLES } from './rules.js';
export type { Action, Rule } from './rules.js';

function holdsAny(actorRoles: readonly Role[], ruleRoles: readonly Rule['roles'][number][]): boolean {
  return ruleRoles.some((role) => actorRoles.includes(role));
}

function predicateHolds(rule: Rule, resource: Resource): boolean {
  if (!rule.when) return true;
  try {
    return rule.when(resource);
  } catch {
    // Totality beats a clever rule: a predicate that throws simply does not match.
    return false;
  }
}

/**
 * Tool visibility is declared in the spec as `visibleTo` and passed here as a
 * resource attribute, so the intersection with the actor's roles happens inside the
 * policy module rather than in the console. It gates every role, admin included: a
 * tool that does not list you is not yours to open.
 */
function toolVisibilityDenial(
  actorRoles: readonly Role[],
  action: string,
  resource: Resource,
): Decision | undefined {
  if (action !== 'tool.view') return undefined;
  const visibleTo = resource.attrs?.['visibleTo'];
  if (!Array.isArray(visibleTo)) return undefined;
  if (visibleTo.some((role) => actorRoles.includes(role as Role))) return undefined;
  return { allowed: false, reason: `tool ${resource.id} is not visible to your roles` };
}

/**
 * The roles an actor held at a moment in time, for the audit row.
 *
 * This lives in the policy module because it is the only module permitted to read
 * the claim set, and because callers should have exactly one reason to reach for
 * roles outside it: recording what they were, never deciding on them.
 */
export function rolesSnapshot(actor: Actor): string[] {
  return Array.isArray(actor?.roles) ? [...actor.roles] : [];
}

/**
 * Whether the actor holds a live unmask grant for this resource type. The grant is
 * the second gate on PII; `can(actor, 'pii.unmask', …)` is the first.
 */
export function hasUnmaskGrant(actor: Actor, resourceType: string, at: Date): boolean {
  return (actor.unmaskGrants ?? []).some(
    (grant) => grant.resourceType === resourceType && Date.parse(grant.expiresAt) > at.getTime(),
  );
}

export function can(actor: Actor, action: string, resource: Resource): Decision {
  const actorRoles: readonly Role[] = Array.isArray(actor?.roles) ? actor.roles : [];

  const visibility = toolVisibilityDenial(actorRoles, action, resource);
  if (visibility) return visibility;

  for (const rule of ALLOW_RULES) {
    const actionMatch = rule.actions.includes('*') || rule.actions.includes(action);
    if (!actionMatch) continue;
    if (!holdsAny(actorRoles, rule.roles)) continue;
    if (!predicateHolds(rule, resource)) continue;
    return { allowed: true, reason: rule.reason };
  }

  return {
    allowed: false,
    reason: `no rule grants ${action} on ${resource.type} (deny by default)`,
  };
}
