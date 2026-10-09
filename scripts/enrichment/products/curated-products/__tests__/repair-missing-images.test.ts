import { describe, expect, it } from "vitest";

import {
  brandImageRef,
  classifyImageRefs,
  curatedProductImageRef,
  publicObjectUrl,
  repairImages,
  type ClassifiedImage,
  type HeadStatus,
  type ImageRef,
} from "../repair-missing-images";

/**
 * The staging image-gap repair (DEV-1989, SP2-33).
 *
 * Every network and write effect is injected — `scripts/check-test-boundaries.mjs`
 * forbids vi.mock of `@/lib/services/` and `@/lib/supabase/`, so HEAD, the
 * mirror and the row clear are handed in as recording doubles.
 */

const STAGING = "stagingref";
const PRODUCTION = "prodref";

function ref(overrides: Partial<ImageRef> = {}): ImageRef {
  return {
    kind: "curated_product",
    id: "p1",
    brandSlug: "island-studio",
    key: "curated-products/b1/p1.webp",
    imageUrl: "/i/curated-products/b1/p1.webp",
    ...overrides,
  };
}

/** A HEAD double answering from a url → status table; unknown urls 404. */
function headFrom(table: Record<string, number>): {
  head: HeadStatus;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    head: async (url) => {
      calls.push(url);
      return table[url] ?? 404;
    },
  };
}

describe("publicObjectUrl", () => {
  it("builds the public object url, encoding each key segment", () => {
    expect(publicObjectUrl(STAGING, "brands/b1/a b.webp")).toBe(
      "https://stagingref.supabase.co/storage/v1/object/public/brand-images/brands/b1/a%20b.webp",
    );
  });
});

describe("curatedProductImageRef", () => {
  it("resolves a proxy image_url to its public key", () => {
    expect(
      curatedProductImageRef({
        id: "p1",
        image_url: "/i/curated-products/b1/p1.webp",
        brands: [{ slug: "island-studio" }],
      }),
    ).toEqual(ref());
  });

  it("returns null for a url that names no public key", () => {
    expect(
      curatedProductImageRef({
        id: "p1",
        image_url: "https://shop.example/p1.jpg",
        brands: null,
      }),
    ).toBeNull();
    expect(
      curatedProductImageRef({
        id: "p1",
        image_url: "/i/submissions/b1/p1.webp",
        brands: null,
      }),
    ).toBeNull();
  });
});

describe("brandImageRef", () => {
  it("prefers storage_path over the url", () => {
    expect(
      brandImageRef({
        id: "i1",
        url: "/i/brands/b1/old.webp",
        storage_path: "brands/b1/hero.webp",
        status: "active",
        brands: { slug: "island-studio" },
      }),
    ).toEqual({
      kind: "brand_image",
      id: "i1",
      brandSlug: "island-studio",
      key: "brands/b1/hero.webp",
      imageUrl: "/i/brands/b1/old.webp",
      status: "active",
    });
  });

  it("falls back to the url when storage_path is null", () => {
    expect(
      brandImageRef({
        id: "i1",
        url: "/i/brands/b1/hero.webp",
        storage_path: null,
        status: "candidate",
        brands: null,
      })?.key,
    ).toBe("brands/b1/hero.webp");
  });
});

describe("classifyImageRefs", () => {
  const okKey = "curated-products/b1/ok.webp";
  const mirrorKey = "brands/b1/mirror.webp";
  const goneKey = "curated-products/b1/gone.webp";
  const flakyKey = "curated-products/b1/flaky.webp";

  it("classifies ok, mirrorable, dangling and unknown, one HEAD per key", async () => {
    const { head, calls } = headFrom({
      [publicObjectUrl(STAGING, okKey)]: 200,
      [publicObjectUrl(STAGING, mirrorKey)]: 400,
      [publicObjectUrl(PRODUCTION, mirrorKey)]: 200,
      [publicObjectUrl(STAGING, goneKey)]: 404,
      [publicObjectUrl(PRODUCTION, goneKey)]: 400,
      [publicObjectUrl(STAGING, flakyKey)]: 503,
    });

    const classified = await classifyImageRefs({
      refs: [
        ref({ id: "a", key: okKey }),
        ref({ id: "b", kind: "brand_image", key: mirrorKey }),
        ref({ id: "c", key: goneKey }),
        // Same key as "c": classified from the cached HEAD.
        ref({ id: "d", key: goneKey }),
        ref({ id: "e", key: flakyKey }),
      ],
      head,
      stagingRef: STAGING,
      productionRef: PRODUCTION,
    });

    expect(classified.map((entry) => [entry.ref.id, entry.state])).toEqual([
      ["a", "ok"],
      ["b", "mirrorable"],
      ["c", "dangling"],
      ["d", "dangling"],
      ["e", "unknown"],
    ]);
    // ok: staging only; mirrorable/dangling: both; unknown: staging only, and
    // goneKey is probed once despite two rows.
    expect(calls).toHaveLength(6);
    expect(classified[4]).toMatchObject({ stagingStatus: 503, productionStatus: null });
  });

  it("never calls a production failure dangling", async () => {
    const { head } = headFrom({
      [publicObjectUrl(STAGING, goneKey)]: 404,
      [publicObjectUrl(PRODUCTION, goneKey)]: 0,
    });

    const [entry] = await classifyImageRefs({
      refs: [ref({ key: goneKey })],
      head,
      stagingRef: STAGING,
      productionRef: PRODUCTION,
    });

    expect(entry!.state).toBe("unknown");
  });
});

describe("repairImages", () => {
  function classified(
    state: ClassifiedImage["state"],
    overrides: Partial<ImageRef> = {},
  ): ClassifiedImage {
    return {
      ref: ref(overrides),
      state,
      stagingStatus: state === "ok" ? 200 : 404,
      productionStatus: state === "mirrorable" ? 200 : 404,
    };
  }

  function doubles(stagingAfterMirror: Record<string, number> = {}) {
    const mirrored: string[] = [];
    const cleared: string[] = [];
    return {
      mirrored,
      cleared,
      deps: {
        head: async (url: string) => stagingAfterMirror[url] ?? 200,
        mirror: async (key: string) => {
          mirrored.push(key);
        },
        clearImage: async (id: string) => {
          cleared.push(id);
        },
      },
    };
  }

  const plan = [
    classified("ok", { id: "a", key: "curated-products/b1/a.webp" }),
    classified("mirrorable", {
      id: "b",
      kind: "brand_image",
      key: "brands/b1/b.webp",
    }),
    classified("mirrorable", {
      id: "b2",
      kind: "brand_image",
      key: "brands/b1/b.webp",
    }),
    classified("dangling", {
      id: "c",
      key: "curated-products/b1/c.webp",
      imageUrl: "/i/curated-products/b1/c.webp",
    }),
    classified("dangling", {
      id: "d",
      kind: "brand_image",
      key: "brands/b1/d.webp",
    }),
  ];

  it("writes nothing in a dry run", async () => {
    const { deps, mirrored, cleared } = doubles();

    const report = await repairImages({
      classified: plan,
      apply: false,
      clearDangling: true,
      stagingRef: STAGING,
      deps,
    });

    expect(mirrored).toEqual([]);
    expect(cleared).toEqual([]);
    expect(report).toMatchObject({
      mirrored: [],
      cleared: [],
      failures: [],
    });
  });

  it("mirrors each mirrorable key once and confirms it on staging", async () => {
    const { deps, mirrored, cleared } = doubles();

    const report = await repairImages({
      classified: plan,
      apply: true,
      clearDangling: false,
      stagingRef: STAGING,
      deps,
    });

    expect(mirrored).toEqual(["brands/b1/b.webp"]);
    expect(report.mirrored).toEqual(["brands/b1/b.webp"]);
    // Without --clear-dangling nothing is cleared.
    expect(cleared).toEqual([]);
  });

  it("counts a mirror the staging re-HEAD does not confirm as a failure", async () => {
    const { deps } = doubles({
      [publicObjectUrl(STAGING, "brands/b1/b.webp")]: 404,
    });

    const report = await repairImages({
      classified: plan,
      apply: true,
      clearDangling: false,
      stagingRef: STAGING,
      deps,
    });

    expect(report.mirrored).toEqual([]);
    expect(report.failures).toEqual([
      "mirror brands/b1/b.webp: staging still answers 404 after upload",
    ]);
  });

  it("clears dangling curated products only, recording the old image_url", async () => {
    const { deps, cleared } = doubles();

    const report = await repairImages({
      classified: plan,
      apply: true,
      clearDangling: true,
      stagingRef: STAGING,
      deps,
    });

    expect(cleared).toEqual(["c"]);
    expect(report.cleared).toEqual([
      {
        id: "c",
        brandSlug: "island-studio",
        oldImageUrl: "/i/curated-products/b1/c.webp",
      },
    ]);
    // The dangling brand image is reported, never written.
    expect(report.danglingBrandImagesReportOnly).toEqual(["d"]);
  });

  it("carries a failed write and keeps going", async () => {
    const { deps } = doubles();
    deps.mirror = async () => {
      throw new Error("boom");
    };

    const report = await repairImages({
      classified: plan,
      apply: true,
      clearDangling: true,
      stagingRef: STAGING,
      deps,
    });

    expect(report.failures).toEqual(["mirror brands/b1/b.webp: boom"]);
    expect(report.cleared.map((entry) => entry.id)).toEqual(["c"]);
  });
});
