/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["@remotion/bundler", "@remotion/renderer"],
    // Enables instrumentation.ts (runs patchDnsLookup() at server boot —
    // resilient DNS for every outbound connection; router DNS flakes here).
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
