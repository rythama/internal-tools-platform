// Flat config (ESLint 9). Deliberately minimal — one rule here is load-bearing.
import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['**/node_modules/**', '**/.next/**', '**/*.d.ts'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      /**
       * ARCHITECTURE.md §3.3: authorization decisions live in exactly one place.
       * An inline role comparison anywhere else is a policy rule that no test covers
       * and no auditor can find. This makes that architectural claim machine-checked
       * rather than aspirational — which is the only kind of architectural claim that
       * survives contact with an agent writing code at volume.
       */
      'no-restricted-syntax': [
        'error',
        {
          selector: "BinaryExpression[operator=/^[!=]==?$/][left.property.name='role']",
          message: "Inline role comparison. Authorization goes through can() in packages/core/src/policy.",
        },
        {
          selector: "CallExpression[callee.property.name='includes'][callee.object.property.name='roles']",
          message: "Inline roles.includes() check. Authorization goes through can() in packages/core/src/policy.",
        },
        {
          selector: "MemberExpression[object.name='actor'][property.name='roles']",
          message: "Direct actor.roles access outside the policy module. Call can() instead.",
        },
      ],
    },
  },
  {
    // The policy module is the one place allowed to reason about roles directly.
    files: ['packages/core/src/policy/**/*.ts', 'packages/core/src/index.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    /**
     * Two console files legitimately touch the claim set, and both are named here
     * rather than working around the selectors, so the exemption is visible in review:
     *
     * - `policy-stub.ts` is a temporary local stand-in for packages/core/src/policy
     *   (Session 1 is implementing the real one). It is the only place in the console
     *   that decides anything, and it is deleted when core lands.
     * - `session.ts` is the OIDC-shaped session issuer (§3.2). It mints and displays
     *   the claim set — the role switcher has to show which roles you are carrying —
     *   which is identity, not authorization.
     */
    files: [
      'apps/console/src/core-adapter/policy-stub.ts',
      'apps/console/src/lib/session.ts',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
