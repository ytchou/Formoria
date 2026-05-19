import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async redirects() {
    return [
      {
        source: '/brands',
        destination: '/',
        permanent: true,
      },
      {
        source: '/brands/:slug',
        destination: '/:slug',
        permanent: true,
      },
      {
        source: '/category/:category',
        destination: '/categories/:category',
        permanent: true,
      },
      {
        source: '/categories',
        destination: '/',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
