/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources, not build output — one less build step
  // between an edit and the console reflecting it.
  transpilePackages: ['@itp/core', '@itp/ui'],
  webpack: (config) => {
    // `tools/index.ts` imports specs with the ESM-correct `./x/spec.js` specifier, which
    // `registry.test.ts` asserts and tsc's bundler resolution accepts. webpack resolves
    // the literal path unless told that a `.js` request may be satisfied by the `.ts`
    // source, so without this the barrel typechecks and tests, then fails `next build`.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
