import { describe, expect, it } from "vitest";
import {
  CROP_DAMAGE_WEIGHT,
  JUNK_TAGS,
  MIN_KEEP_SCORE,
  PORTRAIT_QUALITY_PRIOR,
  applyClassifications,
  buildBrandContext,
  failureReason,
  parseClassificationBatch,
  partitionLoadedImages,
  planChunkImageWrites,
} from "../classify-images";
import { preferPatched } from "../descriptions";
import { CLEARED_FIELDS_KEY } from "../../brand-write-policy";
import type { OpenAIChatResult } from "../../openai-client";

/**
 * These cover the policy decisions that ship together:
 *   1. `logo` is not junk — a clean brand mark represents the brand.
 *   2. Hero ordering is a PURE quality sort. The tag no longer participates:
 *      a higher-scoring logo outranks a lower-scoring product photo.
 *   3. Shape is corrected in two independent terms, not one flat penalty:
 *        heroQuality = score - cropDamagePenalty - portraitQualityPrior
 *      `cropDamagePenalty` computes how much of the image the 4/3 hero frame
 *      actually destroys, scaled across damage 0.10-0.50 to CROP_DAMAGE_WEIGHT
 *      points. Logos take zero crop damage — they render `object-contain` and
 *      are never cut.
 *      `PORTRAIT_QUALITY_PRIOR` is the residual QUALITY effect that survives
 *      conditioning on crop damage (portraits skew toward Instagram crops and
 *      screenshots), which is why it survived the rewrite and the old flat
 *      wide-aspect penalty did not.
 *   4. Both are corrections, never exclusions — a portrait-only brand still gets
 *      a hero.
 *
 * The reference corrections these tests are derived from:
 *   1200x900 (exact 4/3)  -> 0.0    1000x1000 (square) -> 4.5
 *   1600x670 (2.39:1)     -> 10.3   900x1200 (3:4)     -> 16.1
 *   800x1200 (2:3)        -> 18.0   (12.0 crop cap + 6 portrait prior)
 */

type Classified = Parameters<typeof applyClassifications>[0][number];

function classified(
  id: string,
  tag: Classified["tag"],
  score: number,
  storagePath: string | null = `brands/${id}.jpg`,
): Classified {
  // Exactly 4/3, so the default image takes ZERO shape correction and
  // orientation only matters where a test sets it. This used to be 1200x800,
  // which is 1.5:1 — harmless under the old threshold-based penalties, but under
  // computed crop damage it loses 11% of its area and quietly costs 0.3 points.
  return {
    id,
    tag,
    score,
    storage_path: storagePath,
    width: 1200,
    height: 900,
  };
}

function portrait(image: Classified): Classified {
  return { ...image, width: 800, height: 1200 };
}

/** 1000x1000 — damage 0.25, the shape the deleted flat penalties charged nothing. */
function square(image: Classified): Classified {
  return { ...image, width: 1000, height: 1000 };
}

/** 1600x670 (2.39:1) — clears the 3:1 download gate, crops badly as a hero. */
function wide(image: Classified): Classified {
  return { ...image, width: 1600, height: 670 };
}

describe("applyClassifications ordering", () => {
  it("ranks purely by score, so a better logo beats a worse product photo", () => {
    const { ordered } = applyClassifications([
      classified("product", "product", 85),
      classified("logo", "logo", 95),
    ]);

    expect(ordered.map((image) => image.id)).toEqual(["logo", "product"]);
  });

  it("orders every kept image by score regardless of tag", () => {
    const { ordered } = applyClassifications([
      classified("low", "product", 70),
      classified("high", "product", 90),
      classified("mid", "logo", 80),
    ]);

    expect(ordered.map((image) => image.id)).toEqual(["high", "mid", "low"]);
  });

  it("demotes a portrait image below a slightly worse landscape one", () => {
    const { ordered } = applyClassifications([
      portrait(classified("tall", "product", 90)),
      classified("flat", "product", 80),
    ]);

    // 800x1200 takes the full 12-point crop cap plus the 6-point portrait prior:
    // 90 - 18 = 72, against an untouched 80. (Under the old flat penalty this
    // was 90 - 15 = 75 vs 80 — same outcome, wider margin.)
    expect(ordered.map((image) => image.id)).toEqual(["flat", "tall"]);
  });

  it("lets a clearly better portrait image still win the hero slot", () => {
    const { ordered } = applyClassifications([
      portrait(classified("tall", "product", 95)),
      classified("flat", "product", 70),
    ]);

    // 95 - 18 = 77 vs 70. The headroom shrank from 10 points to 7 when the
    // portrait correction rose from 15 to 18, but a 25-point quality gap still
    // carries the portrait.
    expect(ordered.map((image) => image.id)).toEqual(["tall", "flat"]);
  });

  it("keeps a portrait-only brand orderable rather than dropping it", () => {
    const { ordered, rejectedIds } = applyClassifications([
      portrait(classified("a", "product", 70)),
      portrait(classified("b", "product", 88)),
    ]);

    expect(rejectedIds).toEqual([]);
    expect(ordered.map((image) => image.id)).toEqual(["b", "a"]);
  });

  it("demotes a wide image below a slightly worse square one", () => {
    const { ordered } = applyClassifications([
      wide(classified("banner", "product", 85)),
      square(classified("boxy", "product", 80)),
    ]);

    // Both shapes are now charged, which is the point — the old version of this
    // test compared against a 1200x800 "square" that was really 1.5:1 and paid
    // nothing, so it survived by coincidence rather than by asserting the model.
    // 2.39:1 clears the 3:1 download gate but crops badly as a hero: 85 - 10.3 =
    // 74.7, below the square's 80 - 4.5 = 75.5. Demoted at ranking, not excluded.
    expect(ordered.map((image) => image.id)).toEqual(["boxy", "banner"]);
  });

  it("lets a clearly better wide image still lead", () => {
    const { ordered } = applyClassifications([
      wide(classified("banner", "product", 95)),
      square(classified("boxy", "product", 80)),
    ]);

    // 95 - 10.3 = 84.7 vs 80 - 4.5 = 75.5.
    expect(ordered.map((image) => image.id)).toEqual(["banner", "boxy"]);
  });

  it("leaves an exactly-4/3 landscape image unpenalised", () => {
    const { ordered } = applyClassifications([
      classified("landscape", "product", 82),
      classified("other", "product", 85),
    ]);

    // 1200x900 fills the hero box exactly, so nothing is cut and the sort is
    // the raw score: 85 then 82.
    expect(ordered.map((image) => image.id)).toEqual(["other", "landscape"]);
  });

  it("prefers an exactly-framed landscape over a square of equal quality", () => {
    // The discrimination the computed term buys and the flat penalties could
    // not express: a square scored nothing under a 2:1 wide threshold and was
    // not portrait either, so it used to tie. It loses a quarter of its area to
    // the 4/3 crop: 85 - 4.5 = 80.5 against an untouched 85.
    const { ordered } = applyClassifications([
      square(classified("boxy", "product", 85)),
      classified("framed", "product", 85),
    ]);

    expect(ordered.map((image) => image.id)).toEqual(["framed", "boxy"]);
  });

  it("never crops a logo, however far from 4/3 it is", () => {
    // Logos render `object-contain` and are letterboxed rather than cut, so the
    // crop term must be exactly zero for them. Same shape, same score as the
    // product photo beside it: the logo keeps 90 - 6 (the portrait prior, which
    // is a provenance signal and does apply) while the photo pays 18.
    const { ordered } = applyClassifications([
      portrait(classified("photo", "product", 90)),
      portrait(classified("mark", "logo", 90)),
    ]);

    expect(ordered.map((image) => image.id)).toEqual(["mark", "photo"]);
  });

  it("does not let a shape correction promote junk over a well-framed image", () => {
    // Written against the exported constants, not literals: the corrections may
    // only ever reorder images whose quality scores are within their combined
    // reach. Raising either weight without re-deriving this bound must fail CI
    // rather than quietly seating a worse image in the hero slot.
    const framedScore = 70;
    const junkScore =
      framedScore + CROP_DAMAGE_WEIGHT + PORTRAIT_QUALITY_PRIOR + 1;

    const { ordered } = applyClassifications([
      classified("framed", "product", framedScore),
      portrait(classified("junk", "product", junkScore)),
    ]);

    expect(ordered.map((image) => image.id)).toEqual(["junk", "framed"]);
  });

  it("keeps equally-corrected images in their input order", () => {
    // The re-sort preview and the apply must agree byte for byte, so ties have
    // to resolve deterministically. Corrections are quantised to a tenth of a
    // point precisely so float noise cannot break a tie one way in one run and
    // the other way in the next; the sort's stability does the rest.
    const { ordered } = applyClassifications([
      classified("first", "product", 88),
      square(classified("second", "product", 92.5)),
      classified("third", "product", 88),
    ]);

    // 92.5 - 4.5 = 88 for all three.
    expect(ordered.map((image) => image.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("does not penalise an image with unknown dimensions", () => {
    const { ordered } = applyClassifications([
      { id: "unsized", tag: "product", score: 82, storage_path: null },
      classified("sized", "product", 80),
    ]);

    expect(ordered.map((image) => image.id)).toEqual(["unsized", "sized"]);
  });

  it("keeps a logo out of the rejected set", () => {
    const { ordered, rejectedIds } = applyClassifications([
      classified("logo", "logo", 90),
    ]);

    expect(rejectedIds).toEqual([]);
    expect(ordered.map((image) => image.id)).toEqual(["logo"]);
  });

  it("rejects an explicit reject disposition while retaining its storage object", () => {
    const { ordered, rejectedIds, rejectedUpdates } = applyClassifications([
      {
        id: "banner",
        tag: "product",
        score: 70,
        storage_path: "brands/banner.jpg",
        disposition: "reject",
        rejectionReasons: ["text_dominant"],
      },
    ]);

    expect(rejectedIds).toEqual(["banner"]);
    expect(ordered).toEqual([]);
    expect(rejectedUpdates[0]?.row).toEqual({
      status: "rejected",
      storage_path: "brands/banner.jpg",
      tags: null,
      rejection_reasons: ["text_dominant"],
    });
  });

  it("still rejects LEGACY junk-tagged rows but never product or logo ones", () => {
    const { ordered, rejectedIds } = applyClassifications([
      classified("a", "promo", 90),
      classified("b", "irrelevant", 90),
      classified("c", "product", 60),
      classified("d", "logo", 60),
    ]);

    expect(rejectedIds.toSorted()).toEqual(["a", "b"]);
    expect(ordered.map((image) => image.id).toSorted()).toEqual(["c", "d"]);
  });
});

describe("JUNK_TAGS", () => {
  it("treats logo as a keepable brand image", () => {
    expect(JUNK_TAGS.has("logo")).toBe(false);
  });

  it("covers only the LEGACY rejection tags, not the current keep vocabulary", () => {
    expect([...JUNK_TAGS].toSorted()).toEqual([
      "irrelevant",
      "promo",
      "text_banner",
    ]);
    for (const keepTag of ["product", "logo"]) {
      expect(JUNK_TAGS.has(keepTag)).toBe(false);
    }
    // Legacy keep tags fold into `product`; they must never read as junk.
    for (const legacyKeepTag of ["lifestyle", "packaging"]) {
      expect(JUNK_TAGS.has(legacyKeepTag)).toBe(false);
    }
  });
});

describe("parseClassificationBatch", () => {
  it("accepts only an explicit keep tag or a reject reason", () => {
    const verdicts = parseClassificationBatch(
      JSON.stringify({
        classifications: [
          {
            id: "1",
            disposition: "keep",
            tag: "logo",
            reasons: [],
            score: 91,
            alt_zh: "品牌標誌",
            alt_en: "Brand logo",
          },
          {
            id: "2",
            disposition: "reject",
            tag: null,
            reasons: [],
            score: 80,
            alt_zh: "",
            alt_en: "",
          },
          {
            id: "3",
            disposition: "reject",
            tag: null,
            reasons: ["wrong_brand"],
            score: 10,
            alt_zh: "",
            alt_en: "",
          },
        ],
      }),
    );

    expect(verdicts.get("1")).toMatchObject({
      disposition: "keep",
      tag: "logo",
    });
    expect(verdicts.has("2")).toBe(false);
    expect(verdicts.get("3")).toMatchObject({
      disposition: "reject",
      tag: null,
      reasons: ["wrong_brand"],
    });
  });

  it("demotes a keep that scores below the quality floor", () => {
    const verdicts = parseClassificationBatch(
      JSON.stringify({
        classifications: [
          {
            id: "1",
            disposition: "keep",
            tag: "product",
            reasons: [],
            score: MIN_KEEP_SCORE - 1,
            alt_zh: "模糊的產品照",
            alt_en: "Blurry product photo",
          },
          {
            id: "2",
            disposition: "keep",
            tag: "product",
            reasons: [],
            score: MIN_KEEP_SCORE,
            alt_zh: "產品照",
            alt_en: "Product photo",
          },
        ],
      }),
    );

    // The floor is enforced here, not in the prompt, so it can be swept against
    // stored scores without re-calling the model.
    expect(verdicts.get("1")).toMatchObject({
      disposition: "reject",
      tag: null,
      reasons: ["low_visual_quality"],
      score: MIN_KEEP_SCORE - 1,
    });
    expect(verdicts.get("2")).toMatchObject({
      disposition: "keep",
      tag: "product",
    });
  });

  it.each(["lifestyle", "packaging"])(
    "still parses a legacy %s row as a kept product image",
    (legacyTag) => {
      const verdicts = parseClassificationBatch(
        JSON.stringify({
          classifications: [
            {
              id: "1",
              disposition: "keep",
              tag: legacyTag,
              reasons: [],
              score: 84,
              alt_zh: "產品照",
              alt_en: "Product photo",
            },
          ],
        }),
      );

      // Narrowing KEEP_TAGS must not turn old rows into null verdicts, which
      // would silently make them hero-ineligible.
      expect(verdicts.get("1")).toMatchObject({
        disposition: "keep",
        tag: "product",
      });
    },
  );

  it("infers keep from a legacy row that carries no disposition field", () => {
    const verdicts = parseClassificationBatch(
      JSON.stringify({
        classifications: [
          {
            id: "1",
            tag: "packaging",
            score: 77,
            alt_zh: "包裝",
            alt_en: "Packaging",
          },
        ],
      }),
    );

    expect(verdicts.get("1")).toMatchObject({
      disposition: "keep",
      tag: "product",
      reasons: [],
    });
  });

  it("maps the legacy promo tag to an explicit rejection reason", () => {
    const verdicts = parseClassificationBatch(
      JSON.stringify({
        classifications: [
          { id: "1", tag: "promo", score: 40, alt_zh: "", alt_en: "" },
        ],
      }),
    );

    expect(verdicts.get("1")).toMatchObject({
      disposition: "reject",
      tag: null,
      reasons: ["promo_subject"],
    });
  });
});

/**
 * The provider/content split decides whether a fully-failed classify run fails
 * its target or stays `succeeded`. Before it existed, a quota-exhausted account
 * and a model refusing one batch of images were both just "failed batches", and
 * the phase reported success for both (2026-08-02).
 */
describe("failureReason", () => {
  function response(overrides: Partial<OpenAIChatResult>): OpenAIChatResult {
    return {
      response: new Response(null),
      data: null,
      content: "ok",
      ok: true,
      status: 200,
      errorBody: null,
      finishReason: "stop",
      refusal: null,
      ...overrides,
    };
  }

  it("classifies a non-2xx as a provider failure", () => {
    expect(
      failureReason(response({ ok: false, status: 429, content: null })),
    ).toEqual({
      reason: "request failed (HTTP 429)",
      kind: "provider",
    });
  });

  it("classifies a refusal, a truncation and an empty body as content failures", () => {
    // The account is alive in all three: the model answered, unusably. These
    // must never fail a target.
    expect(failureReason(response({ refusal: "no" }))?.kind).toBe("content");
    expect(failureReason(response({ finishReason: "length" }))?.kind).toBe(
      "content",
    );
    expect(failureReason(response({ content: "   " }))?.kind).toBe("content");
  });

  it("returns null for a usable response", () => {
    expect(failureReason(response({}))).toBeNull();
  });
});

/**
 * DEV-1374. Our own storage failing to hand over an image's bytes must never be
 * written to the row as a verdict — that is exactly what DEV-1255 did (a fetch
 * failure stored as `low_visual_quality`), and because `getUnclassifiedImages`
 * only selects `tags IS NULL`, the mislabelled row was never reconsidered while
 * image retention deleted the object seven days later.
 */
describe("partitionLoadedImages", () => {
  function image(id: string) {
    return {
      id,
      url: `https://example.supabase.co/storage/v1/object/public/brand-images/brands/${id}.jpg`,
      storage_path: `brands/${id}.jpg`,
    };
  }

  it("drops only the image that failed to load and still sends the rest", () => {
    const chunk = [image("a"), image("b"), image("c")];

    const result = partitionLoadedImages(chunk, [
      "data:image/webp;base64,AAA",
      null,
      "data:image/webp;base64,CCC",
    ]);

    expect(result.failure).toBeNull();
    expect(result.unavailableIds).toEqual(["b"]);
    expect(result.sendable.map((entry) => entry.image.id)).toEqual(["a", "c"]);
  });

  it("blames storage, not the provider, when nothing loaded", () => {
    // The request never reaches the model, so a zero-classification run must
    // fail the target rather than report a green pass — but as OUR failure.
    // `provider` is the kind that sets providerFailure, which feeds Gate C and
    // the LLM circuit breaker; three of those cancel every unstarted target in
    // the job and page for an OpenAI outage that never happened.
    const result = partitionLoadedImages([image("a"), image("b")], [null, null]);

    expect(result.failure?.kind).toBe("storage");
    expect(result.sendable).toEqual([]);
    expect(result.unavailableIds).toEqual(["a", "b"]);
  });

  it("reports nothing unavailable when every image loaded", () => {
    const result = partitionLoadedImages(
      [image("a"), image("b")],
      ["data:image/webp;base64,AAA", "data:image/webp;base64,BBB"],
    );

    expect(result.failure).toBeNull();
    expect(result.unavailableIds).toEqual([]);
    expect(result.sendable).toHaveLength(2);
  });

  it("carries no rejection payload for an unloadable image", () => {
    // Regression guard for the deleted `brokenImageIds` path, whose only
    // consumer wrote status:'rejected' + rejection_reasons:['low_visual_quality'].
    // The partition may only ever report an id; anything shaped like a verdict
    // here would put us back where DEV-1255 started.
    //
    // Necessary but nowhere near sufficient: this function holds no supabase
    // client, so it could not write a row however wrong it got. The write path
    // itself is covered by `planChunkImageWrites` below.
    const result = partitionLoadedImages([image("a")], [null]);

    expect(JSON.stringify(result)).not.toContain("low_visual_quality");
    expect(JSON.stringify(result)).not.toContain("rejection_reasons");
    expect(result).not.toHaveProperty("brokenImageIds");
  });
});

/**
 * DEV-1255, at the layer that actually decides. `partitionLoadedImages` cannot
 * write a row; this is the function whose output IS the set of writes the phase
 * loop performs, so "an image we could not load is never written to" is a
 * property that can fail here rather than a comment nobody can test.
 *
 * The destructive write these guard against was `status:'rejected'` +
 * `rejection_reasons:['low_visual_quality']` on an image OpenAI could not fetch.
 * Because `getUnclassifiedImages` selects `tags IS NULL`, the mislabelled row
 * was never reconsidered, and image retention deleted the object seven days
 * later — 18 brand images, unrecoverable.
 */
describe("planChunkImageWrites", () => {
  function image(id: string) {
    return {
      id,
      url: `https://example.supabase.co/storage/v1/object/public/brand-images/brands/${id}.jpg`,
      storage_path: `brands/${id}.jpg`,
      width: 1200,
      height: 800,
    };
  }

  /** A real keep verdict, built through the parser the phase actually uses. */
  function verdict(disposition: "keep" | "reject") {
    const parsed = parseClassificationBatch(
      JSON.stringify({
        classifications: [
          disposition === "keep"
            ? {
                id: "1",
                disposition: "keep",
                tag: "product",
                reasons: [],
                score: 88,
                alt_zh: "產品照",
                alt_en: "Product photo",
              }
            : {
                id: "1",
                disposition: "reject",
                tag: null,
                reasons: ["wrong_brand"],
                score: 12,
                alt_zh: "",
                alt_en: "",
              },
        ],
      }),
    );
    return parsed.get("1")!;
  }

  const now = "2026-08-07T00:00:00.000Z";

  it("plans no write at all for an image whose bytes we never got", () => {
    // The strong form: not "writes a gentler row", not "writes a null tag" —
    // zero writes. A verdict is supplied for the unavailable image too, so the
    // test still fails if the unavailability check is dropped in favour of
    // trusting whatever the model happened to say about a slot it never saw.
    const chunk = [image("loaded"), image("unloadable")];
    const plan = planChunkImageWrites({
      chunk,
      verdictsByImageId: new Map([
        ["loaded", verdict("keep")],
        ["unloadable", verdict("reject")],
      ]),
      unavailableIds: ["unloadable"],
      now,
    });

    expect(plan.writes.map((write) => write.id)).toEqual(["loaded"]);
    expect(JSON.stringify(plan)).not.toContain("unloadable");
  });

  it("plans no write for an image the model returned no verdict for", () => {
    // Same invariant, different cause: a short or reordered response must leave
    // the row alone rather than inherit a neighbour's verdict.
    const plan = planChunkImageWrites({
      chunk: [image("a")],
      verdictsByImageId: new Map(),
      unavailableIds: [],
      now,
    });

    expect(plan.writes).toEqual([]);
    expect(plan.classifications).toEqual([]);
    expect(plan.unjudgedCount).toBe(1);
  });

  it("writes exactly one row for a judged image, and rejects only on a verdict", () => {
    // The counterweight: the guards above must not be satisfiable by writing
    // nothing at all.
    const plan = planChunkImageWrites({
      chunk: [image("keep"), image("reject")],
      verdictsByImageId: new Map([
        ["keep", verdict("keep")],
        ["reject", verdict("reject")],
      ]),
      unavailableIds: [],
      now,
    });

    expect(plan.rejectedCount).toBe(1);
    expect(plan.writes).toEqual([
      {
        id: "keep",
        row: {
          tags: ["product"],
          score: 88,
          alt_zh: "產品照",
          alt_en: "Product photo",
          status: "active",
          rejection_reasons: null,
          rejected_at: null,
        },
      },
      {
        id: "reject",
        row: {
          tags: null,
          score: 12,
          alt_zh: "",
          alt_en: "",
          status: "rejected",
          rejection_reasons: ["wrong_brand"],
          rejected_at: now,
        },
      },
    ]);
  });
});

/**
 * DEV-1319. A brand with no `purchase_website` was sent name-only context, and
 * the model resolved that ungrounded uncertainty as `wrong_brand` on 12.1% of
 * images against 6.0% for brands with a site — enough to wipe I.A.N Design's
 * entire catalogue, its own indigo-dyed apparel lookbook, in one run. The
 * storefront slug and profile handle are grounding the brand already had and
 * the context simply never passed on.
 */
describe("buildBrandContext identifiers", () => {
  it("does not ground on a revoked website", () => {
    const website = preferPatched(
      { [CLEARED_FIELDS_KEY]: ["purchase_website"] },
      "https://impostor.example",
      "purchase_website",
    );
    const context = buildBrandContext({
      name: "A brand",
      categorySlug: null,
      website,
    });

    expect(context).not.toContain("impostor.example");
    expect(context).toContain("No verified identifier available for this brand.");
  });

  it("uses the Pinkoi store slug when the brand has no website", () => {
    const context = buildBrandContext({
      name: "I.A.N Design",
      categorySlug: null,
      website: null,
      pinkoi: "https://hk.pinkoi.com/store/ian-design?ref_posn=20",
    });

    expect(context).toContain("Pinkoi store: ian-design.");
    expect(context).not.toContain("No verified identifier");
  });

  it("uses an Instagram profile handle", () => {
    const context = buildBrandContext({
      name: "7th Island",
      categorySlug: null,
      website: null,
      instagram: "https://www.instagram.com/7th_island",
    });

    expect(context).toContain("Instagram: @7th_island.");
  });

  it("ignores an Instagram post permalink, which identifies nothing", () => {
    const context = buildBrandContext({
      name: "新夭 BrainHoleSky",
      categorySlug: null,
      website: null,
      instagram: "https://www.instagram.com/p/DWd7Jm9k_xS/",
    });

    // Emitting "@p" would be worse than emitting nothing.
    expect(context).not.toContain("@p");
    expect(context).toContain(
      "No verified identifier available for this brand.",
    );
  });

  it("declares the absence so the prompt can withhold wrong_brand", () => {
    const context = buildBrandContext({
      name: "Some Brand",
      categorySlug: null,
      website: null,
    });

    expect(context).toContain(
      "No verified identifier available for this brand.",
    );
  });

  it("stays silent about absence when any identifier is present", () => {
    const context = buildBrandContext({
      name: "TopNutree",
      categorySlug: null,
      website: "https://www.topnutree.com.tw",
    });

    expect(context).toContain("Official site: topnutree.com.tw.");
    expect(context).not.toContain("No verified identifier");
  });
});
