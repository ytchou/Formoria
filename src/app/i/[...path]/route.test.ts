import { describe, expect, it } from "vitest";

/**
 * The route handler itself is three lines of wiring; everything worth asserting
 * lives in `@/lib/images/image-proxy`, which takes the storage download as a
 * parameter. That is why there is no Supabase mock here — mocking it is
 * forbidden by `scripts/check-test-boundaries.mjs`, and an injected function is
 * a better seam anyway.
 */
import {
  PRIVATE_IMAGE_PREFIXES,
  resolveProxiedImageKey,
  serveProxiedImage,
  type ProxiedImageDownload,
  type ProxiedImageInfo,
  type ProxiedImageObjectInfo,
} from "@/lib/images/image-proxy";

function storageWith(objects: Record<string, string>): {
  download: ProxiedImageDownload;
  requested: string[];
} {
  const requested: string[] = [];
  const download: ProxiedImageDownload = async (key) => {
    requested.push(key);
    const contentType = objects[key];
    if (!contentType) {
      return { data: null, error: { message: "Object not found" } };
    }
    return { data: new Blob(["fake-bytes"], { type: contentType }), error: null };
  };
  return { download, requested };
}

function infoWith(metadata: Record<string, ProxiedImageObjectInfo>): {
  info: ProxiedImageInfo;
  inspected: string[];
} {
  const inspected: string[] = [];
  const info: ProxiedImageInfo = async (key) => {
    inspected.push(key);
    const record = metadata[key];
    if (!record) {
      return { data: null, error: { message: "Object not found" } };
    }
    return { data: record, error: null };
  };
  return { info, inspected };
}

const BRAND_KEY = "brands/2f1c9a4e-0000-4000-8000-000000000001/hero.webp";
const EXHIBITOR_KEY = "event-exhibitors/2026-expo/booth-a1.webp";
const SUBMISSION_KEY = "submissions/2f1c9a4e-0000-4000-8000-000000000002/x.webp";
const CURATED_KEY = "curated-products/some-brand/some-product/abc123.webp";

describe("GET /i/[...path]", () => {
  it("serves an object under brands/", async () => {
    const { download } = storageWith({ [BRAND_KEY]: "image/webp" });

    const response = await serveProxiedImage(BRAND_KEY.split("/"), download);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    await expect(response.text()).resolves.toBe("fake-bytes");
  });

  it("serves an object under event-exhibitors/", async () => {
    const { download } = storageWith({ [EXHIBITOR_KEY]: "image/jpeg" });

    const response = await serveProxiedImage(
      EXHIBITOR_KEY.split("/"),
      download,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it("serves an object under curated-products/", async () => {
    // Added by DEV-1551 task 11: the curated product layer renders publicly and
    // its objects share the now-private `brand-images` bucket.
    const { download } = storageWith({ [CURATED_KEY]: "image/webp" });

    const response = await serveProxiedImage(CURATED_KEY.split("/"), download);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
  });

  it("404s a submissions/ path even when the object exists", async () => {
    // Submission imagery is pre-moderation content. Admin review signs it;
    // this route must never be a way around that.
    const { download, requested } = storageWith({
      [SUBMISSION_KEY]: "image/webp",
    });

    const response = await serveProxiedImage(
      SUBMISSION_KEY.split("/"),
      download,
    );

    expect(response.status).toBe(404);
    expect(requested).toEqual([]);
    // A deny-list, so this asserts what stays PRIVATE. It used to be an
    // allow-list and went stale twice: `curated-products/` and then `events/`.
    expect(PRIVATE_IMAGE_PREFIXES).toEqual(["submissions/"]);
  });

  it("404s a path traversal attempt, raw and encoded", async () => {
    const { download, requested } = storageWith({
      [SUBMISSION_KEY]: "image/webp",
    });

    const attempts: string[][] = [
      ["brands", "..", "submissions", "x.webp"],
      ["brands", "..%2fsubmissions", "x.webp"],
      ["brands", "%2e%2e", "submissions", "x.webp"],
      ["brands", "%252e%252e", "submissions", "x.webp"],
      ["brands", "..\\submissions", "x.webp"],
      ["", "brands", "hero.webp"],
      ["/etc", "passwd"],
      ["submissions", "..", "brands", "hero.webp"],
    ];

    for (const attempt of attempts) {
      const response = await serveProxiedImage(attempt, download);
      expect(response.status, attempt.join("/")).toBe(404);
    }

    expect(requested).toEqual([]);
    expect(resolveProxiedImageKey(undefined)).toBeNull();
    expect(resolveProxiedImageKey([])).toBeNull();
  });

  it("404s an absent object", async () => {
    const { download } = storageWith({});

    const response = await serveProxiedImage(BRAND_KEY.split("/"), download);

    expect(response.status).toBe(404);
  });

  it("sets immutable cache headers", async () => {
    const { download } = storageWith({ [BRAND_KEY]: "image/webp" });

    const response = await serveProxiedImage(BRAND_KEY.split("/"), download);
    const cacheControl = response.headers.get("cache-control") ?? "";

    expect(cacheControl).toContain("immutable");
    expect(cacheControl).toContain("public");
    expect(cacheControl).toContain("max-age=31536000");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("exposes a GET handler on the nodejs runtime", async () => {
    const route = await import("./route");

    expect(typeof route.GET).toBe("function");
    expect(route.runtime).toBe("nodejs");
  });

  it("returns an ETag header on a normal 200", async () => {
    const { download } = storageWith({ [BRAND_KEY]: "image/webp" });
    const { info } = infoWith({
      [BRAND_KEY]: { etag: "abc123", size: 10, lastModified: "2026-09-01T00:00:00Z" },
    });

    const first = await serveProxiedImage(BRAND_KEY.split("/"), download, {
      info,
    });
    const second = await serveProxiedImage(BRAND_KEY.split("/"), download, {
      info,
    });

    expect(first.status).toBe(200);
    expect(first.headers.get("etag")).toBe('"abc123"');
    // Stable across calls for the same object — otherwise every revalidation
    // would miss and transfer the full body again.
    expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
    await expect(first.text()).resolves.toBe("fake-bytes");
  });

  it("returns 304 with no body when If-None-Match matches", async () => {
    const { download, requested } = storageWith({ [BRAND_KEY]: "image/webp" });
    const { info } = infoWith({ [BRAND_KEY]: { etag: "abc123" } });

    const response = await serveProxiedImage(BRAND_KEY.split("/"), download, {
      ifNoneMatch: '"abc123"',
      info,
    });

    expect(response.status).toBe(304);
    await expect(response.text()).resolves.toBe("");
    // The point of the whole feature: a matching revalidation must not pull
    // the object bytes out of storage either.
    expect(requested).toEqual([]);
    expect(response.headers.get("etag")).toBe('"abc123"');
  });

  it("returns 200 with full body when If-None-Match does not match", async () => {
    const { download, requested } = storageWith({ [BRAND_KEY]: "image/webp" });
    const { info } = infoWith({ [BRAND_KEY]: { etag: "abc123" } });

    const response = await serveProxiedImage(BRAND_KEY.split("/"), download, {
      ifNoneMatch: '"stale-etag"',
      info,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("etag")).toBe('"abc123"');
    await expect(response.text()).resolves.toBe("fake-bytes");
    expect(requested).toEqual([BRAND_KEY]);
  });

  it("serves normally when object metadata is unavailable", async () => {
    // A monitoring/caching nicety must never become a new 404 source: if the
    // info call fails, the request degrades to an unconditional 200.
    const { download } = storageWith({ [BRAND_KEY]: "image/webp" });
    const info: ProxiedImageInfo = async () => {
      throw new Error("info exploded");
    };

    const response = await serveProxiedImage(BRAND_KEY.split("/"), download, {
      ifNoneMatch: '"abc123"',
      info,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeNull();
  });

  it("matches a weak validator and the wildcard", async () => {
    const { download } = storageWith({ [BRAND_KEY]: "image/webp" });
    const { info } = infoWith({ [BRAND_KEY]: { etag: '"abc123"' } });

    for (const header of ['W/"abc123"', "*", '"other", "abc123"']) {
      const response = await serveProxiedImage(BRAND_KEY.split("/"), download, {
        ifNoneMatch: header,
        info,
      });
      expect(response.status, header).toBe(304);
    }
  });

  it("derives an ETag from size and last-modified when no etag is returned", async () => {
    const { download } = storageWith({ [BRAND_KEY]: "image/webp" });
    const { info } = infoWith({
      [BRAND_KEY]: { size: 4_096, lastModified: "2026-09-01T00:00:00.000Z" },
    });

    const response = await serveProxiedImage(BRAND_KEY.split("/"), download, {
      info,
    });

    expect(response.headers.get("etag")).toBe(
      `"4096-${Date.parse("2026-09-01T00:00:00.000Z")}"`,
    );
  });

  it("serves a prefix no allow-list ever knew about", async () => {
    // `events/` was found in the bucket by the 2026-08-23 staging backfill,
    // in neither the proxy allow-list nor the read-key list. Under a deny-list
    // it just works, which is the point of the inversion.
    const key = "events/2026-taiwan-creative-expo/hero.webp";
    const { download, requested } = storageWith({ [key]: "image/webp" });

    const response = await serveProxiedImage(key.split("/"), download);

    expect(response.status).toBe(200);
    expect(requested).toEqual([key]);
  });
});
