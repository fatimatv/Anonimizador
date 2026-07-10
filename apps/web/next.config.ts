import type { NextConfig } from 'next';
import path from 'node:path';

const apiInternalUrl = process.env.API_INTERNAL_URL;
const apiRewriteDestination = apiInternalUrl ? `${apiInternalUrl}/:path*` : '/api/:path*';
const workspaceRoot = path.resolve(process.cwd(), '../..');

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        destination: apiRewriteDestination,
        source: '/backend/:path*',
      },
    ];
  },
};

export default nextConfig;
