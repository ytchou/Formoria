import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { withAxiom } from 'next-axiom'
import createNextIntlPlugin from 'next-intl/plugin'
import { ALLOWED_IMAGE_HOSTS } from './src/lib/images/allowed-image-hosts'

// Ensure the E2E admin account is recognised as admin by the Next.js server.
// playwright.config.ts patches ADMIN_EMAILS for the test runner process, but
// the dev server is a separate process — it needs the same patch at startup.
if (process.env.E2E_ADMIN_EMAIL) {
  const current = process.env.ADMIN_EMAILS ?? '';
  const admins = current.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const e2eAdmin = process.env.E2E_ADMIN_EMAIL.trim().toLowerCase();
  if (!admins.includes(e2eAdmin)) {
    process.env.ADMIN_EMAILS = current ? `${current},${process.env.E2E_ADMIN_EMAIL}` : process.env.E2E_ADMIN_EMAIL;
  }
}

const imgSrcHosts = ALLOWED_IMAGE_HOSTS.map((hostname) => `https://${hostname}`).join(' ')
const mapTileImgSrcHosts = 'https://*.tile.openstreetmap.org'
const googleAdsImgSrcHosts = 'https://www.google.com https://www.google.com.tw'
const supabaseOrigin = (() => {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!configuredUrl) return ''
  try {
    return new URL(configuredUrl).origin
  } catch {
    return ''
  }
})()

const nextConfig: NextConfig = {
  serverExternalPackages: ['adm-zip', '@playwright/test'],
  transpilePackages: ['react-simple-maps'],
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
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://challenges.cloudflare.com https://*.sentry.io https://static.cloudflareinsights.com https://e.formoria.com",
              "style-src 'self' 'unsafe-inline'",
              `img-src 'self' data: blob: ${imgSrcHosts} ${mapTileImgSrcHosts} ${googleAdsImgSrcHosts}`,
              "font-src 'self'",
              `connect-src 'self' ${supabaseOrigin} https://e.formoria.com https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://www.google-analytics.com https://analytics.google.com https://www.google.com https://stats.g.doubleclick.net https://challenges.cloudflare.com https://cloudflareinsights.com https://api.axiom.co`,
              "worker-src 'self' blob:",
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
      {
        source: '/index.html',
        destination: '/',
        permanent: true,
      },
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
        source: '/en/category/:category',
        destination: '/en/brands?category=:category',
        permanent: true,
      },
      {
        source: '/zh-TW/category/:category',
        destination: '/brands?category=:category',
        permanent: true,
      },
      {
        source: '/en/categories',
        destination: '/en/brands',
        permanent: true,
      },
      {
        source: '/zh-TW/categories',
        destination: '/brands',
        permanent: true,
      },
      {
        source: '/en/categories/:category',
        destination: '/en/brands?category=:category',
        permanent: true,
      },
      {
        source: '/zh-TW/categories/:category',
        destination: '/brands?category=:category',
        permanent: true,
      },
      {
        source: '/admin/claim-requests',
        destination: '/admin/claims',
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

export default withAxiom(withSentryConfig(withNextIntl(nextConfig), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "formoria",

  project: "formoria",

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
}));
