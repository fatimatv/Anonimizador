import type { NextConfig } from 'next';

const apiInternalUrl = process.env.API_INTERNAL_URL;
const apiRewriteDestination = apiInternalUrl ? `${apiInternalUrl}/:path*` : '/api/:path*';

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
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
