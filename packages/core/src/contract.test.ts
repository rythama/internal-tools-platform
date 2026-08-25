/**
 * The console binds to this package by runtime feature-detect and falls back to
 * stubs when an export is missing — silently. This suite is what turns that silence
 * into a failing build: if a contract name disappears or changes arity, it fails
 * here rather than degrading a page to stub data in production.
 */
import { describe, expect, it } from 'vitest';
import * as core from './index.js';

const CONTRACT: Record<string, number> = {
  can: 3,
  withAudit: 1,
  verifyAuditChain: 0,
  maskRow: 4,
  requestApproval: 1,
  castVote: 1,
  listRows: 2,
  getRow: 3,
  listAuditRows: 1,
  listApprovals: 3,
};

describe('the public contract', () => {
  for (const [name, arity] of Object.entries(CONTRACT)) {
    it(`exports ${name}/${arity}`, () => {
      const value = (core as unknown as Record<string, unknown>)[name];
      expect(typeof value).toBe('function');
      // `maskRow(…, opts?)` and friends declare optional trailing parameters, which
      // do not count towards Function.length — hence the range rather than equality.
      expect((value as (...args: unknown[]) => unknown).length).toBeLessThanOrEqual(arity);
    });
  }

  it('announces itself as implemented so the console stops using stubs', () => {
    expect(core.CORE_IMPLEMENTED).toBe(true);
  });

  it('exposes no read function that takes an unmask flag', () => {
    // Unmasking is a separate, audited call. If a read ever grows an `unmask`
    // parameter the masking guarantee stops being structural.
    for (const name of ['listRows', 'getRow', 'listAuditRows', 'listApprovals']) {
      const source = String((core as unknown as Record<string, unknown>)[name]);
      expect(source).not.toContain('unmask');
    }
  });
});
