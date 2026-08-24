import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * No Supabase mock: `brandImageRejectRefs` is the pure derivation the save path
 * calls, so the legacy-row recovery is exercised directly.
 * `scripts/check-test-boundaries.mjs` forbids the alternative.
 */
import { brandImageRejectRefs } from "@/lib/services/admin-brand-review";
import { ValidationError } from "@/lib/errors";

const SUPABASE_URL = "https://project.supabase.co";
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/brand-images/`;

describe("brandImageRejectRefs", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses storage_path when the row has one", () => {
    expect(
      brandImageRejectRefs([
        { id: "img-1", storage_path: "brands/brand-1/hero.webp", url: null },
      ]),
    ).toEqual(["/i/brands/brand-1/hero.webp"]);
  });

  it("recovers a key from the public url when storage_path is null", () => {
    // The 20260708100000 backfill inserted rows with `url` from
    // `brands.hero_image_url` and `storage_path` NULL. Deriving from
    // `storage_path` alone yielded an empty list, `rejectBrandImages` returned
    // at its guard, and the row stayed active while the UI reported success.
    expect(
      brandImageRejectRefs([
        {
          id: "img-legacy",
          storage_path: null,
          url: `${PUBLIC_PREFIX}brands/brand-1/legacy.webp`,
        },
      ]),
    ).toEqual(["/i/brands/brand-1/legacy.webp"]);
  });

  it("rejects a legacy row alongside a modern one", () => {
    expect(
      brandImageRejectRefs([
        { id: "img-1", storage_path: "brands/brand-1/hero.webp", url: null },
        {
          id: "img-legacy",
          storage_path: null,
          url: `${PUBLIC_PREFIX}brands/brand-1/legacy.webp`,
        },
      ]),
    ).toEqual([
      "/i/brands/brand-1/hero.webp",
      "/i/brands/brand-1/legacy.webp",
    ]);
  });

  it("surfaces an unrecoverable row instead of silently reporting success", () => {
    // Neither a bucket key nor a recognisable public storage URL: skipping it
    // is what made the save a no-op that still rendered as a success.
    expect(() =>
      brandImageRejectRefs([
        {
          id: "img-unrecoverable",
          storage_path: null,
          url: "https://cdn.example.com/off-site.jpg",
        },
      ]),
    ).toThrow(ValidationError);

    expect(() =>
      brandImageRejectRefs([
        { id: "img-empty", storage_path: null, url: null },
      ]),
    ).toThrow(/img-empty/);
  });

  it("returns an empty list when no row was removed", () => {
    expect(brandImageRejectRefs([])).toEqual([]);
  });
});
