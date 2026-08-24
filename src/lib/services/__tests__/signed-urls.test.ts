import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * No Supabase mock: `createSignedUrlsInBatches` takes the signing call as a
 * parameter, so the batching, the ordering and the error surface are all
 * exercised against a plain function. `scripts/check-test-boundaries.mjs`
 * forbids the alternative.
 */
import {
  createSignedUrlsInBatches,
  SIGNED_URL_BATCH_LIMIT,
  SignedUrlError,
  type CreateSignedUrlsFn,
} from "@/lib/services/_shared/signed-urls";
import {
  attachSignedSubmissionImageUrls,
  submissionImageStorageKey,
  type SubmissionReviewImage,
} from "@/lib/services/submissions";

function fakeSigner(): { sign: CreateSignedUrlsFn; batches: string[][] } {
  const batches: string[][] = [];
  const sign: CreateSignedUrlsFn = async (paths) => {
    batches.push(paths);
    return {
      data: paths.map((path) => ({
        path,
        signedUrl: `https://storage.example/${path}?token=tok-${path}`,
        error: null,
      })),
      error: null,
    };
  };
  return { sign, batches };
}

function reviewImage(
  overrides: Partial<SubmissionReviewImage> = {},
): SubmissionReviewImage {
  return {
    id: "img-1",
    submissionId: "sub-1",
    storagePath: null,
    url: "https://project.supabase.co/storage/v1/object/public/brand-images/brands/b/hero.webp",
    source: "owner",
    status: "active",
    sortOrder: 0,
    isLogo: false,
    width: null,
    height: null,
    originBrandImageId: null,
    ...overrides,
  };
}

describe("createSignedUrlsInBatches", () => {
  it("chunks beyond the 100-path batch limit", async () => {
    const { sign, batches } = fakeSigner();
    const paths = Array.from({ length: 250 }, (_, index) => `brands/${index}.webp`);

    const { urls } = await createSignedUrlsInBatches(paths, sign);

    expect(SIGNED_URL_BATCH_LIMIT).toBe(100);
    expect(batches).toHaveLength(3);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(urls).toHaveLength(250);
    expect(urls.every((url) => url?.includes("token="))).toBe(true);
  });

  it("preserves input order across chunk boundaries", async () => {
    const { sign } = fakeSigner();
    const paths = Array.from({ length: 250 }, (_, index) => `brands/${index}.webp`);

    const { urls, byPath } = await createSignedUrlsInBatches(paths, sign);

    // The 150th output belongs to the 150th input, not to the first entry of
    // the chunk it happened to land in.
    urls.forEach((url, index) => {
      expect(url).toBe(
        `https://storage.example/brands/${index}.webp?token=tok-brands/${index}.webp`,
      );
    });
    expect(byPath.get("brands/149.webp")).toContain("brands/149.webp");
  });

  it("surfaces a storage error instead of swallowing it", async () => {
    const failing: CreateSignedUrlsFn = async () => ({
      data: null,
      error: { message: "bucket not found" },
    });

    await expect(
      createSignedUrlsInBatches(["brands/a.webp"], failing),
    ).rejects.toBeInstanceOf(SignedUrlError);
  });

  it("reports a single unsignable path without dropping the rest", async () => {
    const partial: CreateSignedUrlsFn = async (paths) => ({
      data: paths.map((path) => ({
        path,
        signedUrl: path === "brands/missing.webp" ? null : `https://s/${path}?token=t`,
        error: path === "brands/missing.webp" ? "Object not found" : null,
      })),
      error: null,
    });

    const { urls, failures } = await createSignedUrlsInBatches(
      ["brands/a.webp", "brands/missing.webp", "brands/b.webp"],
      partial,
    );

    expect(urls[0]).toContain("token=");
    expect(urls[1]).toBeNull();
    expect(urls[2]).toContain("token=");
    expect(failures).toEqual([
      { path: "brands/missing.webp", message: "Object not found" },
    ]);
  });

  it("pairs by the echoed label, not by position, when the response is reordered", async () => {
    // Supabase echoes `path` on every entry. If the response ever comes back
    // out of request order, zipping by index serves one submission's signed
    // pre-moderation image under another submission's key.
    const reordering: CreateSignedUrlsFn = async (paths) => ({
      data: [...paths]
        .reverse()
        .map((path) => ({ path, signedUrl: `https://s/${path}?token=t`, error: null })),
      error: null,
    });

    const requested = ["brands/a.webp", "brands/b.webp", "brands/c.webp"];
    const { urls, byPath, failures } = await createSignedUrlsInBatches(
      requested,
      reordering,
    );

    expect(failures).toEqual([]);
    requested.forEach((path, index) => {
      expect(urls[index]).toBe(`https://s/${path}?token=t`);
      expect(byPath.get(path)).toBe(`https://s/${path}?token=t`);
    });
  });

  it("accepts a bucket-prefixed echoed label", async () => {
    const prefixed: CreateSignedUrlsFn = async (paths) => ({
      data: paths.map((path) => ({
        path: `brand-images/${path}`,
        signedUrl: `https://s/${path}?token=t`,
        error: null,
      })),
      error: null,
    });

    const { byPath, failures } = await createSignedUrlsInBatches(
      ["brands/a.webp"],
      prefixed,
    );

    expect(failures).toEqual([]);
    expect(byPath.get("brands/a.webp")).toBe("https://s/brands/a.webp?token=t");
  });

  it("fails an omitted path instead of shifting the rest onto wrong keys", async () => {
    // The middle entry is missing and the remainder shifted up: index zipping
    // would hand `brands/b.webp` the URL signed for `brands/c.webp`.
    const shifting: CreateSignedUrlsFn = async (paths) => ({
      data: paths
        .filter((path) => path !== "brands/b.webp")
        .map((path) => ({ path, signedUrl: `https://s/${path}?token=t`, error: null })),
      error: null,
    });

    const { urls, byPath, failures } = await createSignedUrlsInBatches(
      ["brands/a.webp", "brands/b.webp", "brands/c.webp"],
      shifting,
    );

    expect(urls[0]).toBe("https://s/brands/a.webp?token=t");
    expect(urls[1]).toBeNull();
    expect(urls[2]).toBe("https://s/brands/c.webp?token=t");
    expect(byPath.has("brands/b.webp")).toBe(false);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.path).toBe("brands/b.webp");
  });

  it("fails a path the response labelled with something else entirely", async () => {
    const mislabelled: CreateSignedUrlsFn = async () => ({
      data: [
        {
          path: "brands/someone-else.webp",
          signedUrl: "https://s/brands/someone-else.webp?token=t",
          error: null,
        },
      ],
      error: null,
    });

    const { urls, failures } = await createSignedUrlsInBatches(
      ["brands/mine.webp"],
      mislabelled,
    );

    expect(urls).toEqual([null]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.path).toBe("brands/mine.webp");
  });

  it("falls back to positional zipping when no entry carries a label", async () => {
    const unlabelled: CreateSignedUrlsFn = async (paths) => ({
      data: paths.map((path) => ({
        path: null,
        signedUrl: `https://s/${path}?token=t`,
        error: null,
      })),
      error: null,
    });

    const { urls } = await createSignedUrlsInBatches(
      ["brands/a.webp", "brands/b.webp"],
      unlabelled,
    );

    expect(urls).toEqual([
      "https://s/brands/a.webp?token=t",
      "https://s/brands/b.webp?token=t",
    ]);
  });

  it("skips the storage call entirely when there is nothing to sign", async () => {
    const sign = vi.fn();

    const { urls } = await createSignedUrlsInBatches([], sign);

    expect(sign).not.toHaveBeenCalled();
    expect(urls).toEqual([]);
  });
});

describe("admin submission images", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolve to a signed URL, never an /i/ path", async () => {
    // `/i/` deliberately 404s `submissions/`, because those are unreviewed
    // uploads. Admin review must sign them.
    const submissionImage = reviewImage({
      id: "img-staged",
      storagePath: "submissions/sub-1/photo.webp",
      url: "https://project.supabase.co/storage/v1/object/public/brand-images/submissions/sub-1/photo.webp",
    });
    const publishedImage = reviewImage({
      id: "img-published",
      storagePath: "brands/b/hero.webp",
    });
    const { sign, batches } = fakeSigner();

    const result = await attachSignedSubmissionImageUrls(
      [submissionImage, publishedImage],
      (paths) => createSignedUrlsInBatches(paths, sign),
    );

    expect(batches).toEqual([["submissions/sub-1/photo.webp"]]);
    expect(result[0].url).toContain("token=");
    expect(result[0].url).not.toContain("/i/");
    // A published brand image is public: it is left exactly as it was.
    expect(result[1].url).toBe(publishedImage.url);
  });

  it("recovers the key from the public url when storage_path is null", () => {
    // 23 legacy `submission_images` rows carry a null `storage_path` and only
    // the public URL (DEV-1374).
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");

    expect(
      submissionImageStorageKey(
        reviewImage({
          storagePath: null,
          url: "https://project.supabase.co/storage/v1/object/public/brand-images/submissions/sub-1/legacy.webp",
        }),
      ),
    ).toBe("submissions/sub-1/legacy.webp");

    expect(
      submissionImageStorageKey(reviewImage({ storagePath: "brands/b/hero.webp" })),
    ).toBeNull();
    expect(
      submissionImageStorageKey(
        reviewImage({ storagePath: null, url: "https://example.com/off-site.jpg" }),
      ),
    ).toBeNull();
  });
});
