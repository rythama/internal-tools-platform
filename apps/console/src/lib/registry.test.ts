import { readdirSync, existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actorForRole } from './session';
import { allSpecs, canViewTool, visibleSpecs } from './registry';

const TOOLS_DIR = join(process.cwd(), 'tools');

describe('tool registry', () => {
  it('lists every tools/<name>/spec.ts in the barrel', () => {
    if (!existsSync(TOOLS_DIR)) return;
    const barrel = readFileSync(join(TOOLS_DIR, 'index.ts'), 'utf8');
    const specDirs = readdirSync(TOOLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(TOOLS_DIR, entry.name, 'spec.ts')))
      .map((entry) => entry.name);

    for (const dir of specDirs) {
      expect(barrel, `tools/${dir}/spec.ts exists but is not registered in tools/index.ts`).toContain(
        `./${dir}/spec.js`,
      );
    }
  });

  it('hides a tool from roles its spec does not list', () => {
    const spec = allSpecs()[0];
    expect(spec).toBeDefined();
    if (!spec) return;

    const included = spec.visibleTo[0];
    expect(included).toBeDefined();
    if (!included) return;

    expect(canViewTool(actorForRole(included), spec).allowed).toBe(true);

    const excluded = (['kyc_reviewer', 'kyc_approver', 'refund_agent', 'refund_approver', 'flag_admin', 'auditor'] as const).find(
      (role) => !spec.visibleTo.includes(role),
    );
    expect(excluded).toBeDefined();
    if (!excluded) return;

    const decision = canViewTool(actorForRole(excluded), spec);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('not visible to your roles');
    expect(visibleSpecs(actorForRole(excluded))).not.toContain(spec);
  });

  it('shows admin everything the deployment hosts', () => {
    expect(visibleSpecs(actorForRole('admin'))).toEqual(allSpecs());
  });
});
