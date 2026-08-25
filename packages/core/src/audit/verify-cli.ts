/**
 * `npm run audit:verify` — walks the seeded chain and exits non-zero on the first
 * break, so tampering fails the build rather than being noticed by someone reading
 * the log later.
 */
import { databasePath } from '../db/client';
import { verifyAuditChain } from './index';

const result = verifyAuditChain();

if (result.ok) {
  console.log(`audit chain intact — ${databasePath()}`);
  process.exit(0);
}

console.error(`audit chain BROKEN at seq ${result.brokenAtSeq} — ${databasePath()}`);
process.exit(1);
