/**
 * Canonicalization and hashing for the audit chain (ARCHITECTURE.md §3.4).
 *
 * Key order is the whole game here: JSON.stringify preserves insertion order, so two
 * semantically identical rows built by different code paths would hash differently
 * and the chain would break for no reason. Keys are sorted at every depth.
 */
import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

export function canonicalJSON(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJSON(entry)}`);
  return `{${entries.join(',')}}`;
}

/** hash = sha256(prevHash || canonicalJSON(row-without-hash)). */
export function chainHash(prevHash: string, payload: unknown): string {
  return createHash('sha256').update(`${prevHash}${canonicalJSON(payload)}`).digest('hex');
}

/** Stable, non-reversible stand-in for a PII value inside an audit diff (§3.5). */
export function hashPiiValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJSON(value)).digest('hex')}`;
}
