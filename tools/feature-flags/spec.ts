/**
 * Feature flags (devin/tasks/04-tools-two-and-three.md).
 *
 * Deliberately the simplest tool the platform hosts: a queue of flags, a toggle, and
 * rollout presets. Two things the spec model cannot say, both in
 * `apps/console/src/tools/feature-flags.ts`:
 *   - "any prod change requires a second approver" is a string equality on
 *     `environment`; `approvalThreshold` is a single numeric `>` on one field, so the
 *     trigger is a tool-supplied predicate that can only ADD an approval hop;
 *   - the column patch each action applies (flip `enabled`, set `rolloutPercent`).
 *
 * Rollout is set via presets rather than a free-form percentage because a spec action
 * carries no payload — a parameterized action would be a custom form and route, and
 * this tool is meant to stay on the declarative floor.
 */
import type { ToolSpec } from '@itp/core';

export const spec: ToolSpec = {
  key: 'feature-flags',
  title: 'Feature flags',
  description:
    'Toggle flags and stage rollout percentages. Any change to a prod flag needs a second flag admin’s signature.',
  visibleTo: ['flag_admin', 'auditor', 'admin'],
  queue: {
    table: 'feature_flags',
    columns: [
      { field: 'key', label: 'Flag' },
      { field: 'environment', label: 'Environment', width: 110 },
      { field: 'enabled', label: 'Enabled', width: 80 },
      { field: 'rolloutPercent', label: 'Rollout %', width: 90 },
      { field: 'updatedAt', label: 'Updated' },
    ],
    filters: [
      { field: 'environment', label: 'Environment', options: ['dev', 'staging', 'prod'] },
      { field: 'enabled', label: 'Enabled', options: ['yes', 'no'] },
    ],
    defaultSort: { field: 'key', dir: 'asc' },
  },
  detail: {
    sections: [
      { label: 'Flag', fields: ['key', 'description', 'environment'] },
      { label: 'State', fields: ['enabled', 'rolloutPercent', 'updatedAt'] },
    ],
  },
  actions: [
    {
      key: 'toggle',
      label: 'Toggle flag',
      permission: 'flag.toggle',
      intent: 'neutral',
    },
    {
      key: 'rollout_25',
      label: 'Set rollout to 25%',
      permission: 'flag.toggle',
      intent: 'neutral',
    },
    {
      key: 'rollout_50',
      label: 'Set rollout to 50%',
      permission: 'flag.toggle',
      intent: 'neutral',
    },
    {
      key: 'rollout_100',
      label: 'Set rollout to 100%',
      permission: 'flag.toggle',
      intent: 'positive',
    },
  ],
};
