import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The workspace packages ship .tsx sources; the root tsconfig sets jsx: 'preserve'
  // for Next, so the test transform needs its own JSX setting.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.{ts,tsx}', 'apps/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
    server: { deps: { inline: [/@itp\//] } },
  },
});
