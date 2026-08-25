/**
 * Mutation testing for the security-critical controls.
 *
 * Applies each mutant below to a control in turn, runs the test suite, and
 * requires the suite to FAIL. A mutant the suite does not kill means a control
 * has no regression guard, so this script exits non-zero.
 *
 * The original file contents are captured up front and restored after every
 * mutant (and on interrupt), so the tree is never left mutated.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const READ = path.join(root, 'packages/core/src/read/index.ts');
const APPROVALS = path.join(root, 'packages/core/src/approvals/index.ts');
const UI_LOGIC = path.join(root, 'packages/ui/src/logic.ts');

type Mutant = {
  name: string;
  file: string;
  /** Exact source snippet to replace. The script fails if it is not found. */
  find: string;
  replace: string;
};

const mutants: Mutant[] = [
  {
    name: 'listRows returns unmasked rows',
    file: READ,
    find: '    .map((row) => maskValues(table, row) as T);',
    replace: '    .map((row) => row as T);',
  },
  {
    name: 'getRow returns an unmasked row',
    file: READ,
    find: `  if (!row || !readable(actor, table, row)) return undefined;
  return maskValues(table, row) as T;
}`,
    replace: `  if (!row || !readable(actor, table, row)) return undefined;
  return row as T;
}`,
  },
  {
    name: 'castVote counts duplicate votes from the same voter',
    file: APPROVALS,
    find: `  const existing = votesFor(row.id);
  if (existing.some((vote) => vote.voterSub === args.actor.sub)) {
    return { state: settledState(row.state) };
  }`,
    replace: `  const existing = votesFor(row.id);`,
  },
  {
    name: 'castVote allows self-approval',
    file: APPROVALS,
    find: `  if (row.disallowSelfApproval && row.requestedBy === args.actor.sub) {
    throw auditDenial({
      actor: args.actor,
      action: 'approval.vote',
      resource,
      decisionReason: SELF_APPROVAL_REASON,
      diff: { approvalId: row.id },
    });
  }`,
    replace: ``,
  },
  {
    name: 'needsApproval fails open on an unresolvable threshold',
    file: UI_LOGIC,
    find: `  if (!(threshold.field in row)) return true;
  const value = row[threshold.field];
  if (typeof value !== 'number') return true;`,
    replace: `  if (!(threshold.field in row)) return false;
  const value = row[threshold.field];
  if (typeof value !== 'number') return false;`,
  },
];

const originals = new Map<string, string>();
for (const mutant of mutants) {
  if (!originals.has(mutant.file)) originals.set(mutant.file, readFileSync(mutant.file, 'utf8'));
}

function restoreAll(): void {
  for (const [file, contents] of originals) writeFileSync(file, contents);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    restoreAll();
    process.exit(1);
  });
}

function suitePasses(): boolean {
  const result = spawnSync('npx', ['vitest', 'run'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, CI: 'true' },
  });
  return result.status === 0;
}

let survivors = 0;
try {
  for (const mutant of mutants) {
    const original = originals.get(mutant.file);
    if (original === undefined) throw new Error(`no original captured for ${mutant.file}`);
    if (!original.includes(mutant.find)) {
      throw new Error(
        `mutant "${mutant.name}": target snippet not found in ${path.relative(root, mutant.file)}. ` +
          'The source changed; update scripts/mutate.ts.',
      );
    }

    writeFileSync(mutant.file, original.replace(mutant.find, mutant.replace));
    const survived = suitePasses();
    restoreAll();

    if (survived) {
      survivors += 1;
      console.error(`SURVIVED  ${mutant.name}`);
    } else {
      console.log(`killed    ${mutant.name}`);
    }
  }
} finally {
  restoreAll();
}

if (survivors > 0) {
  console.error(`\n${survivors} of ${mutants.length} mutants survived — a control is untested.`);
  process.exit(1);
}
console.log(`\nall ${mutants.length} mutants killed`);
