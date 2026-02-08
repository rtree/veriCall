import { execSync } from 'child_process';

// Inject git commit SHA at build time for source code attestation
const SOURCE_CODE_COMMIT = process.env.SOURCE_CODE_COMMIT
  || (() => { try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return 'unknown'; } })();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable React Server Components to avoid React2Shell vulnerability attack surface
  // The vulnerability affects React Server Components in versions 19.0.0, 19.1.0, 19.1.1, 19.2.0
  // We're using patched version 19.0.1, but keeping minimal RSC usage as defense in depth
  
  // Enable standalone output for Cloud Run deployment
  output: 'standalone',
  
  // Disable x-powered-by header for security
  poweredByHeader: false,
  
  // Expose build-time env vars
  env: {
    SOURCE_CODE_COMMIT,
  },
  
  // Configure headers for security
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
