/**
 * The domain write path.
 *
 * `withAudit()` guarantees that a mutation and its audit row share a transaction, but
 * it hands the caller an opaque `tx` — and tools live outside this package, where the
 * schema and the drizzle handle are not reachable. Without this module a tool has two
 * options: reach into core's internals, or talk to the database itself. Both are
 * exactly what ARCHITECTURE.md §2 forbids, so the write path belongs here next to the
 * read path.
 *
 * The primitive is deliberately narrow: patch named columns of one row of one domain
 * table, under a permission that `can()` checks, with a field-level diff on the chain.
 * Platform tables are refused outright — the audit chain and the approval state
 * machine are not rows a tool may update.
 */
import { eq } from 'drizzle-orm';
import { withAudit, type Tx } from '../audit/index';
import {
  columnNames,
  isPlatformTable,
  primaryKeyColumn,
  primaryKeyValue,
  tableFor,
} from '../db/tables';
import { maskValues } from '../pii/index';
import { policyAttrs, selectAll } from '../read/index';
import type { Actor } from '../types';

export type RowDiff = Record<string, { before: unknown; after: unknown }>;

/**
 * Applies `patch` to one row and records it. Returns the updated row, masked like any
 * other read, or undefined when the row does not exist.
 *
 * Denials throw `PolicyDeniedError` from `withAudit`, audited first. A patch naming a
 * column the table does not have is a programming error and throws before any audit
 * row is written: nothing was attempted, so there is nothing to record.
 */
export function updateRow<T extends Record<string, unknown>>(args: {
  table: string;
  id: string;
  patch: Record<string, unknown>;
  actor: Actor;
  /** The action `can()` is asked about, and the name this lands on the chain under. */
  permission: string;
  /** Merged into the audit diff, e.g. the spec action key that caused the write. */
  context?: Record<string, unknown>;
}): T | undefined {
  const target = tableFor(args.table);
  if (!target || isPlatformTable(args.table)) {
    throw new Error(`${args.table} is not a writable domain table`);
  }

  const columns = columnNames(target);
  for (const field of Object.keys(args.patch)) {
    if (!columns.includes(field)) {
      throw new Error(`unknown column ${field} on ${args.table}`);
    }
  }

  const before = selectAll(args.table).find(
    (candidate) => primaryKeyValue(candidate) === args.id,
  );
  if (!before) return undefined;

  // Classified columns are not special-cased here: `appendAudit` hashes any diff key
  // that schema.ts classifies for this table, so the chain records "this changed"
  // without recording the value (§3.4/§3.5).
  const diff: RowDiff = {};
  for (const [field, after] of Object.entries(args.patch)) {
    diff[field] = { before: before[field], after };
  }

  const pk = primaryKeyColumn(target);
  if (!pk) throw new Error(`${args.table} has no single-column primary key`);

  withAudit({
    actor: args.actor,
    action: args.permission,
    resource: { type: args.table, id: args.id, attrs: policyAttrs(before) },
    diff: { ...(args.context ?? {}), ...diff },
    mutate: (handle) => {
      // An action with no column effect is still an action: it is recorded, and the
      // UPDATE is skipped rather than issued with nothing to set.
      if (Object.keys(args.patch).length === 0) return;
      (handle as Tx).update(target).set(args.patch).where(eq(pk, args.id)).run();
    },
  });

  return maskValues(args.table, { ...before, ...args.patch }) as T;
}
