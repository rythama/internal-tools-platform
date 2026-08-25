/**
 * Tool registry.
 *
 * Every tool is a `tools/<name>/spec.ts` exporting a `ToolSpec`, and every spec is
 * listed here. The barrel is explicit rather than discovered at runtime because the
 * console is bundled: a bundler cannot follow a path assembled from a directory
 * listing, and a registry that only works in dev is worse than one that is one line
 * long. `registry.test.ts` fails CI if a spec file exists and is not listed here, so
 * "forgot to register it" is a red test rather than a missing nav item.
 */
import type { ToolSpec } from '@itp/core';
import { spec as kycReview } from './kyc-review/spec.js';

export const specs: readonly ToolSpec[] = [kycReview];
