import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";
import { ALLOWED_IMAGE_HOSTS } from "./src/lib/images/allowed-image-hosts";

// Ensure the E2E admin account is recognised as admin by the Next.js server.
// playwright.config.ts patches ADMIN_EMAILS for the test runner process, but
// the dev server is a separate process — it needs the same patch at startup.
if (process.env.E2E_ADMIN_EMAIL) {
  const current = process.env.ADMIN_EMAILS ?? "";
  const admins = current
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const e2eAdmin = process.env.E2E_ADMIN_EMAIL.trim().toLowerCase();
  if (!admins.includes(e2eAdmin)) {
    process.env.ADMIN_EMAILS = current
      ? `${current},${process.env.E2E_ADMIN_EMAIL}`
      : process.env.E2E_ADMIN_EMAIL;
  }
}

/**
 * Retired L1 taxonomy slugs and the category that absorbed each one.
 *
 * Pairs, not a record, so the two slugs that both merged into
 * `bags-accessories` stay expressible.
 *
 * Every `to` must be a LIVE L1 in `src/lib/taxonomy/ontology.ts`, and no live
 * L1 may appear as a `from`. DEV-1510 split `kids-pets` into `kids` and `pets`,
 * which broke both halves of that rule at once: `pets` became a live L1 while a
 * `["pets", "kids-pets"]` row still shadowed it. Both rows are gone; deferred
 * legacy kids traffic goes directly to the public directory below.
 */
const RETIRED_CATEGORY_SLUGS: ReadonlyArray<
  readonly [from: string, to: string]
> = [
  ["accessories", "bags-accessories"],
  ["bags", "bags-accessories"],
  ["food", "food-drink"],
  ["beverages", "food-drink"],
  ["clothing", "fashion"],
];

const imgSrcHosts = ALLOWED_IMAGE_HOSTS.map(
  (hostname) => `https://${hostname}`,
).join(" ");
/*
 * SIGNED submission URLs only (DEV-1551). `ALLOWED_IMAGE_HOSTS` is empty since
 * the `brand-images` bucket went private and every published image is served
 * from `/i/` on this origin — but admin review still renders pre-moderation
 * imagery from a short-lived signed Supabase URL in a plain `<img>`, and CSP
 * would block it without this. It is deliberately NOT in `ALLOWED_IMAGE_HOSTS`:
 * that list governs `safeImageSrc` and `next/image`, and re-adding it there
 * would let a public page hotlink the storage host again.
 */
const signedStorageImgSrcHosts = "https://*.supabase.co";
const mapTileImgSrcHosts = "https://*.tile.openstreetmap.org";
const googleAdsImgSrcHosts = "https://www.google.com https://www.google.com.tw";
const supabaseOrigin = (() => {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!configuredUrl) return "";
  try {
    return new URL(configuredUrl).origin;
  } catch {
    return "";
  }
})();

const nextConfig: NextConfig = {
  // Railway injects `RAILWAY_ENVIRONMENT_NAME` into the build, but only a
  // `NEXT_PUBLIC_` name is inlined into the browser bundle. Without this
  // mirror, `resolveSentryEnvironment()` finds no deploy marker on the client
  // and every browser error from production reports as `local` (DEV-1561).
  // Omitted entirely when absent so a local build keeps resolving to `local`.
  ...(process.env.RAILWAY_ENVIRONMENT_NAME?.trim()
    ? {
        env: {
          NEXT_PUBLIC_RAILWAY_ENVIRONMENT_NAME:
            process.env.RAILWAY_ENVIRONMENT_NAME,
        },
      }
    : {}),
  serverExternalPackages: ["adm-zip", "@playwright/test"],
  transpilePackages: ["react-simple-maps"],
  experimental: {
    turbopackFileSystemCacheForDev: false,
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  images: {
    /*
     * EMPTY since DEV-1551 task 11. `ALLOWED_IMAGE_HOSTS` has no entries: the
     * `brand-images` bucket is private and every image we own is served from
     * `/i/` on this origin, which `next/image` optimises without a remote
     * pattern. Kept as a map over the constant rather than a literal `[]` so
     * the two lists cannot drift apart.
     */
    remotePatterns: ALLOWED_IMAGE_HOSTS.map((hostname) => ({
      protocol: "https" as const,
      hostname,
    })),
    // WebP only, no AVIF: brand images are already stored as WebP (1,647 of
    // ~2,027 storage objects; src/app/api/upload/route.ts writes
    // contentType: 'image/webp'), so AVIF's marginal payload win over an
    // already-efficient source does not justify its much slower encode on a
    // container whose optimizer cache is ephemeral and re-derives on cold start.
    formats: ["image/webp"],
    // The optimizer cache lives on the single Railway container's ephemeral disk,
    // so every cold start re-derives from source. A long TTL maximises reuse within
    // a container's lifetime; 30 days bounds staleness if a brand image is replaced
    // at the same URL.
    minimumCacheTTL: 2592000,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://challenges.cloudflare.com https://*.sentry.io https://static.cloudflareinsights.com https://e.formoria.com",
              "style-src 'self' 'unsafe-inline'",
              `img-src 'self' data: blob: ${imgSrcHosts} ${signedStorageImgSrcHosts} ${mapTileImgSrcHosts} ${googleAdsImgSrcHosts}`,
              "font-src 'self'",
              `connect-src 'self' ${supabaseOrigin} https://e.formoria.com https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://www.google-analytics.com https://analytics.google.com https://www.google.com https://stats.g.doubleclick.net https://challenges.cloudflare.com https://cloudflareinsights.com`,
              "worker-src 'self' blob:",
              "frame-src https://challenges.cloudflare.com",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join("; "),
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/index.html",
        destination: "/",
        permanent: true,
      },
      // Legacy singular category routes redirect to the product catalog.
      {
        source: "/category/:category",
        destination: "/discover?category=:category",
        statusCode: 301,
      },
      {
        source: "/en/category/:category",
        destination: "/en/discover?category=:category",
        statusCode: 301,
      },
      {
        source: "/zh-TW/category/:category",
        destination: "/discover?category=:category",
        statusCode: 301,
      },
      // L1 taxonomy slugs that were merged or renamed. Search Console reports
      // every one of these still being crawled and 404ing, so the equity they
      // earned is recoverable — category pages are the highest-value non-brand
      // URLs in the directory.
      //
      // `/category/:category` above already 301s the singular form into
      // `/categories/:category`, so a legacy `/category/food` now resolves in
      // two hops rather than landing on a 404. Two is within Google's budget;
      // do not stack a third by pointing anything here at another alias.
      ...RETIRED_CATEGORY_SLUGS.flatMap(([from, to]) => [
        {
          source: `/categories/${from}`,
          destination: `/discover?category=${to}`,
          permanent: true,
        },
        {
          source: `/en/categories/${from}`,
          destination: `/en/discover?category=${to}`,
          permanent: true,
        },
        {
          source: `/zh-TW/categories/${from}`,
          destination: `/discover?category=${to}`,
          permanent: true,
        },
      ]),
      // `others` was a catch-all bucket with no successor L1; the product
      // catalog is the closest surface that still answers the same intent.
      {
        source: "/categories/others",
        destination: "/discover",
        permanent: true,
      },
      {
        source: "/en/categories/others",
        destination: "/en/discover",
        permanent: true,
      },
      {
        source: "/zh-TW/categories/others",
        destination: "/discover",
        permanent: true,
      },
      // `kids-pets` was split into two live L1s (DEV-1510), so neither half is
      // the successor — sending 母嬰 traffic to `pets` or the reverse is worse
      // than sending both to the directory. It sits here rather than in
      // RETIRED_CATEGORY_SLUGS because that table only expresses
      // category-to-category moves, and it is added only now that both
      // `-> kids-pets` rows above are gone: with either still standing this
      // would be the second hop of a redirect chain.
      {
        // `kids` is a deferred L1, so the old baby-kids page redirects to the
        // product catalog root.
        source: "/categories/baby-kids",
        destination: "/discover",
        permanent: true,
      },
      {
        source: "/en/categories/baby-kids",
        destination: "/en/discover",
        permanent: true,
      },
      {
        source: "/zh-TW/categories/baby-kids",
        destination: "/discover",
        permanent: true,
      },
      {
        source: "/categories/kids-pets",
        destination: "/discover",
        permanent: true,
      },
      {
        source: "/en/categories/kids-pets",
        destination: "/en/discover",
        permanent: true,
      },
      {
        source: "/zh-TW/categories/kids-pets",
        destination: "/discover",
        permanent: true,
      },
      // `crafts` was dissolved, not merged (DEV-1507): its L2s scattered across
      // `home`, `jewelry`, `bags-accessories` and `stationery`, so no single L1
      // is the successor and RETIRED_CATEGORY_SLUGS — whose every `to` must be
      // a live L1 — cannot express it. Same shape as `kids-pets` above.
      {
        source: "/categories/crafts",
        destination: "/discover",
        permanent: true,
      },
      {
        source: "/en/categories/crafts",
        destination: "/en/discover",
        permanent: true,
      },
      {
        source: "/zh-TW/categories/crafts",
        destination: "/discover",
        permanent: true,
      },
      // The L2 rows below are DERIVED from the ontology diff, not written by
      // hand: a Next `source` is a literal path, so the L1 rows above rescue
      // `/categories/crafts` and leave every `/categories/crafts/<l2>` URL
      // 404ing. Regenerate with
      // `pnpm exec tsx scripts/generate-category-redirects.ts --write`.
      // >>> generated by scripts/generate-category-redirects.ts - do not edit by hand
      // 29 L2 URLs left the vocabulary with the dissolved L1s:
      // 10 deleted with no successor, 2 relocated, 17 reparented.
      // Keys are (parent, slug) pairs — a bare slug would shadow the live
      // /categories/food-drink/beverages page, whose slug is also a retired L1.
      ...(
        [
          ["crafts/ceramics", "/brands"],
          ["crafts/woodcraft", "/brands"],
          ["crafts/metalwork", "/brands"],
          ["crafts/bamboo-craft", "/brands"],
          ["crafts/glass-art", "/brands"],
          ["crafts/natural-dyeing", "/brands"],
          ["crafts/leather-craft", "/brands"],
          ["crafts/embroidery", "/brands"],
          ["crafts/needle-felting", "/brands"],
          ["crafts/weaving-and-crochet", "/brands"],
          [
            "crafts/illustration-and-art",
            "/discover?category=home&sub=wall-art",
          ],
          [
            "crafts/dried-flowers-and-floral-design",
            "/discover?category=home&sub=floral-arrangements",
          ],
          ["kids-pets/kids-clothing", "/brands"],
          ["kids-pets/family-matching", "/brands"],
          ["kids-pets/baby-clothing", "/brands"],
          ["kids-pets/baby-bedding", "/brands"],
          ["kids-pets/bibs-and-muslin", "/brands"],
          ["kids-pets/kids-tableware", "/brands"],
          ["kids-pets/toys", "/brands"],
          ["kids-pets/learning-aids", "/brands"],
          ["kids-pets/play-mats-and-fences", "/brands"],
          ["kids-pets/parenting-essentials", "/brands"],
          ["kids-pets/pet-food", "/brands"],
          ["kids-pets/pet-treats", "/brands"],
          ["kids-pets/pet-supplements", "/brands"],
          ["kids-pets/pet-apparel", "/brands"],
          ["kids-pets/pet-beds-and-scratchers", "/brands"],
          ["kids-pets/pet-grooming", "/brands"],
          ["kids-pets/pet-supplies", "/brands"],
        ] as ReadonlyArray<readonly [from: string, to: string]>
      ).flatMap(([from, to]) => [
        {
          source: `/categories/${from}`,
          destination: to,
          permanent: true,
        },
        {
          source: `/en/categories/${from}`,
          destination: `/en${to}`,
          permanent: true,
        },
        {
          source: `/zh-TW/categories/${from}`,
          destination: to,
          permanent: true,
        },
      ]),
      // <<< end generated block
      // DEV-1605: event surface parked. Pattern-based so /events/any-slug
      // resolves without listing each past event individually.
      {
        source: "/events/:path*",
        destination: "/",
        permanent: true,
      },
      {
        source: "/events",
        destination: "/",
        permanent: true,
      },
      {
        source: "/en/events/:path*",
        destination: "/en",
        permanent: true,
      },
      {
        source: "/en/events",
        destination: "/en",
        permanent: true,
      },
      {
        source: "/zh-TW/events/:path*",
        destination: "/",
        permanent: true,
      },
      {
        source: "/zh-TW/events",
        destination: "/",
        permanent: true,
      },
      {
        source: "/about-us",
        destination: "/about",
        permanent: true,
      },
      {
        source: "/en/about-us",
        destination: "/en/about",
        permanent: true,
      },
      {
        source: "/zh-TW/about-us",
        destination: "/about",
        permanent: true,
      },
      // The editorial surface was renamed /guides -> /stories. `guides` was also
      // dropped from RESERVED_ROUTES, so without these a bare /guides falls
      // through to SLUG_PATTERN in src/proxy.ts and 301s to /brands/guides,
      // which 404s — a live 301-to-404 chain on a URL that is footer-linked and
      // still listed in the production sitemap.
      // Slugs are NOT preserved: the two /guides/* documents were placeholder
      // content that no longer exists, so /stories/:slug would only 404 again.
      {
        source: "/guides",
        destination: "/stories",
        permanent: true,
      },
      {
        source: "/guides/:slug*",
        destination: "/stories",
        permanent: true,
      },
      {
        source: "/en/guides",
        destination: "/en/stories",
        permanent: true,
      },
      {
        source: "/en/guides/:slug*",
        destination: "/en/stories",
        permanent: true,
      },
      {
        source: "/zh-TW/guides",
        destination: "/stories",
        permanent: true,
      },
      {
        source: "/zh-TW/guides/:slug*",
        destination: "/stories",
        permanent: true,
      },
      {
        source: "/zh-TW/auth/:path*",
        destination: "/auth/:path*",
        permanent: true,
      },
      {
        // DEV-1570: /admin/claims went with the claim flow. The old 308 to it
        // is cached in admin browsers forever, so keep a hop that resolves --
        // temporary (307) so this rule is not itself permanently cached.
        source: "/admin/claim-requests",
        destination: "/admin",
        permanent: false,
      },
      {
        source: "/admin/taxonomy",
        destination: "/admin/catalog/taxonomy",
        permanent: true,
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withSentryConfig(withNextIntl(nextConfig), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "formoria",

  // Staging and production report to SEPARATE Sentry projects, so source-map
  // upload must follow the DSN. `SENTRY_PROJECT` is set on the Railway staging
  // service; production leaves it unset and keeps the default. Hardcoding
  // "formoria" would silently file staging releases and source maps against
  // production the moment a staging `SENTRY_AUTH_TOKEN` is added (DEV-1494).
  project: process.env.SENTRY_PROJECT ?? "formoria",

  // Never silence the source-map upload. `silent: !process.env.CI` hid the real
  // `sentry-cli` error on Railway, where `CI` is unset, leaving only
  // "failed with exit code 1" in the build log (DEV-1537).
  silent: false,

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
