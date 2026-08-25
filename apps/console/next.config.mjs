/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources, not build output — one less build step
  // between an edit and the console reflecting it.
  transpilePackages: ['@itp/core', '@itp/ui'],
};

export default nextConfig;
