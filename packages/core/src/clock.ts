/**
 * The one place this package reads the time.
 *
 * Audit timestamps are part of the hashed payload, so a seed that is supposed to be
 * deterministic cannot call `Date.now()`. The seed pins the clock; everything else
 * gets wall time.
 */
/**
 * The reference instant the seed is built around: seeded timestamps spread from
 * ~5 days before to ~3 days after it. UI features that compare against "now"
 * (SLA badges) should compare against THIS when showing seeded data — wall-clock
 * time drifts away from the pinned data a little more every day, until every row
 * reads as breached and the badge carries no signal.
 */
export const DEMO_EPOCH = '2025-01-06T09:00:00.000Z';

let fixed: { at: number; stepMs: number } | undefined;

export function now(): string {
  if (!fixed) return new Date().toISOString();
  const value = new Date(fixed.at).toISOString();
  fixed.at += fixed.stepMs;
  return value;
}

/** Pins the clock to `start`, advancing by `stepMs` on every read. */
export function useFixedClock(start: string, stepMs = 1000): void {
  fixed = { at: Date.parse(start), stepMs };
}

export function useSystemClock(): void {
  fixed = undefined;
}
