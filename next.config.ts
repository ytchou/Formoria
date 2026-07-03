import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from 'next-intl/plugin'
import { ALLOWED_IMAGE_HOSTS } from './src/lib/images/allowed-image-hosts'

const imgSrcHosts = ALLOWED_IMAGE_HOSTS.map((hostname) => `https://${hostname}`).join(' ')

const nextConfig: NextConfig = {
  serverExternalPackages: ['adm-zip'],
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
  images: {
    remotePatterns: ALLOWED_IMAGE_HOSTS.map((hostname) => ({
      protocol: 'https',
      hostname,
    })),
  },
  async headers() {
    return [
      {
        source: '/admin/content/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self' https://content.tinajs.io https://identity.tinajs.io",
              "img-src 'self' data: blob: https://assets.tinajs.io",
              "font-src 'self' data:",
              "frame-src https://identity.tinajs.io",
              "frame-ancestors 'self'",
            ].join('; '),
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://challenges.cloudflare.com https://*.sentry.io",
              "style-src 'self' 'unsafe-inline'",
              `img-src 'self' data: blob: ${imgSrcHosts}`,
              "font-src 'self'",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://www.google-analytics.com https://challenges.cloudflare.com",
              "frame-src https://challenges.cloudflare.com",
              "frame-ancestors 'none'",
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
      // Legacy category routes consolidate into the brands directory filter.
      {
        source: '/category/:category',
        destination: '/brands?category=:category',
        permanent: true,
      },
      {
        source: '/categories',
        destination: '/brands',
        permanent: true,
      },
      {
        source: '/categories/:category',
        destination: '/brands?category=:category',
        permanent: true,
      },
      {
        source: '/admin/submissions',
        destination: '/admin/review-queue/submissions',
        permanent: true,
      },
      {
        source: '/admin/moderation',
        destination: '/admin/review-queue/moderation',
        permanent: true,
      },
      {
        source: '/admin/pending-edits',
        destination: '/admin/review-queue/edits',
        permanent: true,
      },
      {
        source: '/admin/claim-requests',
        destination: '/admin/claims',
        permanent: true,
      },
      {
        source: '/admin/reports',
        destination: '/admin/signals/reports',
        permanent: true,
      },
      {
        source: '/admin/feedback',
        destination: '/admin/signals/feedback',
        permanent: true,
      },
      {
        source: '/admin/brands',
        destination: '/admin/catalog/brands',
        permanent: true,
      },
      {
        source: '/admin/taxonomy',
        destination: '/admin/catalog/taxonomy',
        permanent: true,
      },
    ]
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

export default withSentryConfig(withNextIntl(nextConfig), {
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
