import { describe, expect, it } from "vitest";

/**
 * The route handler itself is three lines of wiring; everything worth asserting
 * lives in `@/lib/images/image-proxy`, which takes the storage download as a
 * parameter. That is why there is no Supabase mock here — mocking it is
 * forbidden by `scripts/check-test-boundaries.mjs`, and an injected function is
 * a better seam anyway.
 */
import {
  PROXIED_IMAGE_PREFIXES,
  resolveProxiedImageKey,
  serveProxiedImage,
  type ProxiedImageDownload,
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
    expect(PROXIED_IMAGE_PREFIXES).toEqual([
      "brands/",
      "event-exhibitors/",
      "curated-products/",
    ]);
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
});
