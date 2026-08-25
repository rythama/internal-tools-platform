import { coreIsImplemented } from '../core-adapter/index';
import { usingDemoSpec } from '../lib/registry';

/**
 * Says out loud when the console is running against stubs. A demo that silently
 * looks finished while half of it is a placeholder is how a prototype gets mistaken
 * for a product.
 */
export function StubBanner() {
  if (coreIsImplemented && !usingDemoSpec()) return null;
  const missing = [
    coreIsImplemented ? null : '@itp/core runtime (Session 1) — using the local stub adapter',
    usingDemoSpec() ? 'no tools/*/spec.ts registered yet (Session 3) — showing a demo spec' : null,
  ].filter((item): item is string => item !== null);

  return (
    <p className="stub-banner">
      <strong>Shell running against stubs.</strong> {missing.join(' · ')}
    </p>
  );
}
