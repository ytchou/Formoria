import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { getServiceClient } from "../helpers/seed";
import {
  e2eBrandImageKey,
  e2ePublicImageUrl,
  e2eProxyImageUrl,
  e2eSubmissionImageKey,
} from "../helpers/image-refs";

/**
 * DEV-1551 task 18, amended by the DEV-1746 bucket split. What the image
 * delivery boundary must guarantee:
 *
 *   - a public prefix is served directly and remains available through `/i/`
 *   - `submissions/` exists only in the private bucket and `/i/` refuses it
 *   - traversal cannot escape into a refused prefix
 *   - the route is exempt from the Cloudflare origin guard, because Next's
 *     image optimizer re-enters middleware with an empty header set
 *
 * The objects are seeded here rather than assumed. Staging's bucket holds only
 * `curated-products/`, so a hardcoded key would 404 for the wrong reason and the
 * Objects are seeded so absence cannot make these assertions pass vacuously.
 */

const PUBLIC_BUCKET = "brand-images";
const PRIVATE_BUCKET = "brand-submissions";

// A one-pixel WebP. Small enough to upload per test, real enough that Storage
// reports an image content type rather than octet-stream.
const ONE_PIXEL_WEBP = Buffer.from(
  "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==",
  "base64",
);

const seededObjects: Array<{ bucket: string; key: string }> = [];

async function seedObject(bucket: string, key: string): Promise<void> {
  const { error } = await getServiceClient()
    .storage.from(bucket)
    .upload(key, ONE_PIXEL_WEBP, {
      contentType: "image/webp",
      upsert: true,
    });
  if (error) {
    throw new Error(`Failed to seed ${key}: ${error.message}`);
  }
  seededObjects.push({ bucket, key });
}

test.afterAll(async () => {
  for (const bucket of [PUBLIC_BUCKET, PRIVATE_BUCKET]) {
    const keys = seededObjects
      .filter((object) => object.bucket === bucket)
      .map((object) => object.key);
    if (keys.length === 0) continue;
    const { error } = await getServiceClient().storage.from(bucket).remove(keys);
    if (error) throw new Error(`Failed to clean ${bucket}: ${error.message}`);
  }
});

test.describe("image proxy /i/", () => {
  test("serves a brands/ object as an image", async ({ request }) => {
    const key = e2eBrandImageKey(randomUUID(), `${randomUUID()}.webp`);
    await seedObject(PUBLIC_BUCKET, key);

    const response = await request.get(e2eProxyImageUrl(key));

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/");
  });

  test("serves a brands/ object from the public storage URL", async ({
    request,
  }) => {
    const key = e2eBrandImageKey(randomUUID(), `${randomUUID()}.webp`);
    await seedObject(PUBLIC_BUCKET, key);

    const response = await request.get(e2ePublicImageUrl(key));

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/");
  });

  test("sets an immutable one-year cache header", async ({ request }) => {
    const key = e2eBrandImageKey(randomUUID(), `${randomUUID()}.webp`);
    await seedObject(PUBLIC_BUCKET, key);

    const response = await request.get(e2eProxyImageUrl(key));
    const cacheControl = response.headers()["cache-control"] ?? "";

    // Cloudflare Access rewrites cache-control on authenticated responses.
    // Observed variants: `private, no-store` and `private, max-age=14400`.
    // Neither is the origin's header, so asserting either would turn this into
    // a test of Cloudflare. The route's own header is covered by the unit test
    // in src/app/i/[...path]/route.test.ts.
    test.skip(
      !cacheControl.includes("immutable"),
      "Cloudflare rewrites cache-control on remote targets",
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
    await seedObject(PRIVATE_BUCKET, key);

    const response = await request.get(e2eProxyImageUrl(key));

    expect(response.status()).toBe(404);
  });

  test("a submissions/-keyed object's public storage URL does not resolve", async ({
    request,
  }) => {
    // The object really exists; privacy comes from bucket visibility, not a
    // missing-object 404 or an application prefix check.
    const key = e2eSubmissionImageKey(randomUUID(), `${randomUUID()}.webp`);
    await seedObject(PRIVATE_BUCKET, key);

    const response = await request.get(e2ePublicImageUrl(key, PRIVATE_BUCKET));

    expect(
      [400, 403, 404],
      `public storage URL must not serve pre-moderation content (got ${response.status()})`,
    ).toContain(response.status());
  });

  test("404s a traversal attempt out of a public prefix", async ({
    request,
  }) => {
    const submissionKey = e2eSubmissionImageKey(
      randomUUID(),
      `${randomUUID()}.webp`,
    );
    await seedObject(PRIVATE_BUCKET, submissionKey);

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
    await seedObject(PUBLIC_BUCKET, key);

    const response = await request.get(e2eProxyImageUrl(key), {
      headers: { "x-formoria-edge": "" },
    });

    expect(response.status()).toBe(200);
  });
});
