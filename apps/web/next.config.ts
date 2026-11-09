import type { NextConfig } from 'next';

// Baseline security headers. A strict CSP lands in M9 once all third-party origins are known.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    instantInsights: {
      // The signed-in area renders on the client after the auth gate (data comes from the user's
      // own Firestore docs), so only segments that export `instant` are validated.
      validationLevel: 'manual-warning',
    },
  },
  transpilePackages: ['@kosh/core'],
  serverExternalPackages: ['firebase-admin'],
  poweredByHeader: false,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
