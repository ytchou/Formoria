import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { getServiceClient } from "../helpers/seed";
import {
  e2eBrandImageKey,
  e2eProxyImageUrl,
  e2eSubmissionImageKey,
} from "../helpers/image-refs";

/**
 * DEV-1551 task 18: the `/i/[...path]` image proxy contract.
 *
 * The `brand-images` bucket is private, so every public image is served by this
 * route with the service-role key. What the route must guarantee:
 *
 *   - a public prefix is served, with immutable caching
 *   - `submissions/` is refused, because that is pre-moderation content only an
 *     admin may see, and admin review signs its URLs instead
 *   - traversal cannot escape into a refused prefix
 *   - the route is exempt from the Cloudflare origin guard, because Next's
 *     image optimizer re-enters middleware with an empty header set
 *
 * The objects are seeded here rather than assumed. Staging's bucket holds only
 * `curated-products/`, so a hardcoded key would 404 for the wrong reason and the
 * test would pass vacuously.
 */

const BUCKET = "brand-images";

// A one-pixel WebP. Small enough to upload per test, real enough that Storage
// reports an image content type rather than octet-stream.
const ONE_PIXEL_WEBP = Buffer.from(
  "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==",
  "base64",
);

const seededKeys: string[] = [];

async function seedObject(key: string): Promise<void> {
  const { error } = await getServiceClient()
    .storage.from(BUCKET)
    .upload(key, ONE_PIXEL_WEBP, {
      contentType: "image/webp",
      upsert: true,
    });
  if (error) {
    throw new Error(`Failed to seed ${key}: ${error.message}`);
  }
  seededKeys.push(key);
}

test.afterAll(async () => {
  if (seededKeys.length > 0) {
    await getServiceClient().storage.from(BUCKET).remove(seededKeys);
  }
});

test.describe("image proxy /i/", () => {
  test("serves a brands/ object as an image", async ({ request }) => {
    const key = e2eBrandImageKey(randomUUID(), `${randomUUID()}.webp`);
    await seedObject(key);

    const response = await request.get(e2eProxyImageUrl(key));

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/");
  });

  test("sets an immutable one-year cache header", async ({ request }) => {
    const key = e2eBrandImageKey(randomUUID(), `${randomUUID()}.webp`);
    await seedObject(key);

    const response = await request.get(e2eProxyImageUrl(key));
    const cacheControl = response.headers()["cache-control"] ?? "";

    // Cloudflare Access rewrites cache-control to `private, no-store` on every
    // authenticated response, so behind it the origin's header is simply not
    // observable from here. Skipping is honest; asserting the rewritten value
    // would turn this into a test of Cloudflare. The route's own header is
    // covered by the unit test in src/app/i/[...path]/route.test.ts.
    test.skip(
      cacheControl.includes("no-store"),
      "Cloudflare Access rewrote cache-control; origin header not observable",
    );

    // Objects are UUID-addressed and content-immutable, so the CDN absorbs
    // every repeat and the proxy chain runs on cache misses only.
    expect(cacheControl).toContain("immutable");
    expect(cacheControl).toContain("max-age=31536000");
  });

  test("404s a submissions/ object even though it exists", async ({
    request,
  }) => {
    // Seeded deliberately: the refusal must come from the prefix rule, not from
    // the object being absent. That distinction is the whole test.
    const key = e2eSubmissionImageKey(randomUUID(), `${randomUUID()}.webp`);
    await seedObject(key);

    const response = await request.get(e2eProxyImageUrl(key));

    expect(response.status()).toBe(404);
  });

  test("404s a traversal attempt out of a public prefix", async ({
    request,
  }) => {
    const submissionKey = e2eSubmissionImageKey(
      randomUUID(),
      `${randomUUID()}.webp`,
    );
    await seedObject(submissionKey);

    const attempts = [
      `/i/brands/../${submissionKey}`,
      `/i/brands/..%2f${submissionKey}`,
      `/i/brands/%2e%2e/${submissionKey}`,
      `/i/brands/%252e%252e/${submissionKey}`,
    ];

    for (const attempt of attempts) {
      const response = await request.get(attempt);
      expect(
        response.status(),
        `traversal should not resolve: ${attempt}`,
      ).not.toBe(200);
    }
  });

  test("404s an absent object under a served prefix", async ({ request }) => {
    const missing = e2eBrandImageKey(randomUUID(), `${randomUUID()}.webp`);

    const response = await request.get(e2eProxyImageUrl(missing));

    expect(response.status()).toBe(404);
  });

  test("is reachable without the Cloudflare edge header", async ({
    request,
  }) => {
    // `/i/` is in ORIGIN_GUARD_EXEMPT_PATHS. Next's image optimizer fetches a
    // local `src` through an internal request that carries no headers at all,
    // so a guarded `/i/` would 403 the optimizer and break every next/image
    // render site-wide. This asserts the exemption holds.
    const key = e2eBrandImageKey(randomUUID(), `${randomUUID()}.webp`);
    await seedObject(key);

    const response = await request.get(e2eProxyImageUrl(key), {
      headers: { "x-formoria-edge": "" },
    });

    expect(response.status()).toBe(200);
  });
});
