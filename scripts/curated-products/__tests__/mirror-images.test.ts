import { describe, expect, it } from "vitest";

import {
  mirrorImages,
  type MirrorImageRow,
  type MirrorImagesDeps,
} from "../mirror-images";

/**
 * Mirror-images script (DEV-1609).
 *
 * Every seam is injected — `scripts/check-test-boundaries.mjs` forbids
 * vi.mock of `@/lib/services/` and `@/lib/supabase/`.
 */

function row(overrides: Partial<MirrorImageRow> = {}): MirrorImageRow {
  return {
    id: "3f6c2a1b-0d54-4e19-9a77-2b5c8e1d4f30",
    key: "reading-lamp",
    brand_id: "brand-001",
    image_source_url: "https://brand.example.com/product.jpg",
    image_url: null,
    brands: { slug: "reading-lamp-co" },
    ...overrides,
  };
}

function recordingDeps(
  overrides: Partial<MirrorImagesDeps> = {},
): MirrorImagesDeps & {
  storeCalls: { brandId: string; productId: string; imageSourceUrl: string }[];
  updateCalls: {
    id: string;
    values: { image_url: string; image_width: number; image_height: number };
  }[];
  revalidateCalls: string[];
} {
  const storeCalls: {
    brandId: string;
    productId: string;
    imageSourceUrl: string;
  }[] = [];
  const updateCalls: {
    id: string;
    values: { image_url: string; image_width: number; image_height: number };
  }[] = [];
  const revalidateCalls: string[] = [];

  return {
    storeCalls,
    updateCalls,
    revalidateCalls,
    fetchRows:
      overrides.fetchRows ?? (async () => [row()]),
    storeImage:
      overrides.storeImage ??
      (async (input) => {
        storeCalls.push(input);
        return {
          url: "https://cdn.example.com/stored.webp",
          width: 1200,
          height: 900,
        };
      }),
    updateRow:
      overrides.updateRow ??
      (async (id, values) => {
        updateCalls.push({ id, values });
        return { error: null };
      }),
    revalidate:
      overrides.revalidate ??
      (async (slug) => {
        revalidateCalls.push(slug);
      }),
  };
}

describe("mirrorImages", () => {
  it("finds rows needing mirroring (visible, has source, no image_url)", async () => {
    const rows = [
      row({ id: "needs-mirror", image_source_url: "https://example.com/a.jpg", image_url: null }),
      row({ id: "already-mirrored", image_source_url: "https://example.com/b.jpg", image_url: "https://cdn.example.com/b.webp" }),
    ];
    // Only the first row should be selected by the query; the second has image_url set.
    // The test verifies the script processes what fetchRows returns — the query
    // filtering is in the real fetchRows, so here we simulate the expected result.
    const deps = recordingDeps({
      fetchRows: async () => [rows[0]!],
    });

    const report = await mirrorImages({ apply: true, deps });

    expect(report.selected).toBe(1);
  });

  it("dry run does not write", async () => {
    const deps = recordingDeps({
      fetchRows: async () => [
        row({ id: "row-a", key: "a" }),
        row({ id: "row-b", key: "b" }),
      ],
    });

    const report = await mirrorImages({ apply: false, deps });

    expect(report.selected).toBe(2);
    expect(report.skipped).toBe(2);
    expect(report.stored).toBe(0);
    expect(report.written).toBe(0);
    expect(deps.storeCalls).toEqual([]);
    expect(deps.updateCalls).toEqual([]);
    expect(deps.revalidateCalls).toEqual([]);
  });

  it("apply calls storeImage then updates the row with url, width, height", async () => {
    const deps = recordingDeps({
      fetchRows: async () => [row({ id: "row-a", key: "lamp", brand_id: "b-1" })],
      storeImage: async (input) => {
        deps.storeCalls.push(input);
        return { url: "https://cdn.example.com/mirrored.webp", width: 800, height: 600 };
      },
    });

    const report = await mirrorImages({ apply: true, deps });

    expect(deps.storeCalls).toEqual([
      { brandId: "b-1", productId: "row-a", imageSourceUrl: "https://brand.example.com/product.jpg" },
    ]);
    expect(deps.updateCalls).toEqual([
      {
        id: "row-a",
        values: {
          image_url: "https://cdn.example.com/mirrored.webp",
          image_width: 800,
          image_height: 600,
        },
      },
    ]);
    expect(report.stored).toBe(1);
    expect(report.written).toBe(1);
  });

  it("continues on single row failure", async () => {
    const deps = recordingDeps({
      fetchRows: async () => [
        row({ id: "row-a", key: "a", brand_id: "b-1" }),
        row({ id: "row-bad", key: "bad", brand_id: "b-2" }),
        row({ id: "row-c", key: "c", brand_id: "b-3" }),
      ],
      storeImage: async (input) => {
        if (input.productId === "row-bad") throw new Error("download failed");
        deps.storeCalls.push(input);
        return { url: "https://cdn.example.com/ok.webp", width: 1000, height: 750 };
      },
    });

    const report = await mirrorImages({ apply: true, deps });

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain("row-bad");
    expect(report.stored).toBe(2);
    expect(report.written).toBe(2);
    expect(deps.updateCalls.map((c) => c.id).sort()).toEqual(["row-a", "row-c"]);
  });

  it("revalidates affected brands after successful writes", async () => {
    const deps = recordingDeps({
      fetchRows: async () => [
        row({ id: "row-a", key: "a", brands: { slug: "brand-alpha" } }),
        row({ id: "row-b", key: "b", brands: { slug: "brand-beta" } }),
        row({ id: "row-c", key: "c", brands: { slug: "brand-alpha" } }),
      ],
    });

    const report = await mirrorImages({ apply: true, deps });

    expect(report.written).toBe(3);
    // Each unique slug revalidated once.
    expect(deps.revalidateCalls.sort()).toEqual(["brand-alpha", "brand-beta"]);
  });
});
