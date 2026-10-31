/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Types are checked by `npm run typecheck`, which keeps builds light on low-memory machines.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
