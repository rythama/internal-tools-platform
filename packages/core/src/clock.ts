/**
 * The one place this package reads the time.
 *
 * Audit timestamps are part of the hashed payload, so a seed that is supposed to be
 * deterministic cannot call `Date.now()`. The seed pins the clock; everything else
 * gets wall time.
 */
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
