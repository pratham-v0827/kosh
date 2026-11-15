import type { NextConfig } from 'next';
import { securityHeaders } from './security-headers';

const nextConfig: NextConfig = {
  // Development only: the app is also opened as http://127.0.0.1:3000 (the Firebase emulators
  // live on 127.0.0.1, and it gives a clean browser cache when localhost's is stale).
  allowedDevOrigins: ['127.0.0.1'],
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    instantInsights: {
      // The signed-in area renders on the client after the auth gate (data comes from the user's
      // own Firestore docs), so only segments that export `instant` are validated.
      validationLevel: 'manual-warning',
    },
  },
  transpilePackages: ['@kosh/core', '@kosh/contracts', '@kosh/prices', '@kosh/parsers'],
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
    return [{ source: '/:path*', headers: securityHeaders(process.env) }];
  },
};

export default nextConfig;
