import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      { protocol: 'https', hostname: 'cdn01.pinkoi.com' },
      { protocol: 'https', hostname: 'cdn02.pinkoi.com' },
      { protocol: 'https', hostname: 'cms-static.cdn.91app.com' },
      { protocol: 'https', hostname: 'img.gogoshop.cloud' },
      { protocol: 'https', hostname: 'img.shoplineapp.com' },
      { protocol: 'https', hostname: 'shoplineimg.com' },
      { protocol: 'https', hostname: 'twrr.org.tw' },
      { protocol: 'https', hostname: 'www.sobdeall.com.tw' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://challenges.cloudflare.com https://*.sentry.io",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co https://cdn01.pinkoi.com https://cdn02.pinkoi.com https://cms-static.cdn.91app.com https://img.gogoshop.cloud https://img.shoplineapp.com https://shoplineimg.com https://twrr.org.tw https://www.sobdeall.com.tw",
              "font-src 'self'",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://www.google-analytics.com https://challenges.cloudflare.com",
              "frame-src https://challenges.cloudflare.com",
              "form-action 'self'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join('; '),
          },
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
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
  async redirects() {
    return [
      // /:slug → /brands/:slug (301 for SEO continuity — old brand detail URLs at root)
      // Regex scoped to brand slug format: lowercase alphanumeric + hyphens, 3-80 chars
      // Does NOT catch /about, /submit, /admin — dedicated app/ files take priority
      {
        source: '/:slug([a-z0-9][a-z0-9-]{2,79})',
        destination: '/brands/:slug',
        permanent: true,
      },
      // /categories → /brands (brands directory moved to /brands)
      {
        source: '/categories',
        destination: '/brands',
        permanent: true,
      },
      // Legacy /category/:category → /categories/:category (unchanged)
      {
        source: '/category/:category',
        destination: '/categories/:category',
        permanent: true,
      },
    ]
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "yung-tang-chou",

  project: "mit-map",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
