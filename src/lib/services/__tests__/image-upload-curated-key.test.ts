import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CURATED_PRODUCT_IMAGES_KEY_PREFIX,
  curatedProductStorageKeyFromPublicUrl,
  storageKeyFromPublicUrl,
} from "../image-upload";

/**
 * The curated derivation is the DELETE-side key recovery for an image that was
 * REPLACED: `curated_products` has no `image_storage_path` column, so once
 * `image_source_url` changes and the hash-keyed object moves, the previous key
 * exists nowhere but the stored `image_url`.
 *
 * These cases pin the scoping, not the string slicing. Widening this helper to
 * `brands/` would hand curated cleanup a key belonging to an owner upload, and
 * widening `storageKeyFromPublicUrl` to curated keys would hand owner cleanup a
 * curated product's only object — the DEV-1374 asymmetry the last case guards.
 */
const SUPABASE_URL = "https://xkcayngbttpxyibgzern.supabase.co";
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/brand-images/`;
const CURATED_KEY = `${CURATED_PRODUCT_IMAGES_KEY_PREFIX}hanchor/alpine-shell/9f2b7c1d.webp`;

describe("curatedProductStorageKeyFromPublicUrl", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves_curated_public_url_to_key", () => {
    expect(
      curatedProductStorageKeyFromPublicUrl(`${PUBLIC_PREFIX}${CURATED_KEY}`),
    ).toBe(CURATED_KEY);
  });

  it("resolves_curated_proxy_path_to_key", () => {
    // DEV-1551: `image_url` now stores the same-origin `/i/<key>` form, so the
    // previous-object lookup has to recognise it. The legacy public URL above
    // still resolves too — every row written before the flip carries one, and
    // dropping that branch would leak one object per edit.
    expect(curatedProductStorageKeyFromPublicUrl(`/i/${CURATED_KEY}`)).toBe(
      CURATED_KEY,
    );
  });

  it("rejects_a_proxy_path_outside_curated_products", () => {
    expect(
      curatedProductStorageKeyFromPublicUrl("/i/brands/hanchor/logo.webp"),
    ).toBeNull();
  });

  it("rejects_brands_prefix_url", () => {
    // Scoped to curated keys ALONE. An owner brand image resolved here would be
    // deleted by a curated replacement while the brand row still references it.
    expect(
      curatedProductStorageKeyFromPublicUrl(
        `${PUBLIC_PREFIX}brands/hanchor/logo.webp`,
      ),
    ).toBeNull();
  });

  it("rejects_foreign_origin_url", () => {
    expect(
      curatedProductStorageKeyFromPublicUrl(
        `https://cdn.example.test/storage/v1/object/public/brand-images/${CURATED_KEY}`,
      ),
    ).toBeNull();
    expect(curatedProductStorageKeyFromPublicUrl("")).toBeNull();
  });

  it("delete_path_helper_still_rejects_curated", () => {
    // DEV-1374: the brand-image delete path fails CLOSED on anything outside
    // `brands/`. If this ever returns a key, owner cleanup can delete a curated
    // product's only object while `curated_products.image_url` still points at
    // it — a deletion the storage sweep cannot flag, because the reference
    // survives.
    expect(storageKeyFromPublicUrl(`${PUBLIC_PREFIX}${CURATED_KEY}`)).toBeNull();
    expect(storageKeyFromPublicUrl(`${PUBLIC_PREFIX}brands/hanchor/logo.webp`)).toBe(
      "brands/hanchor/logo.webp",
    );
  });
});
