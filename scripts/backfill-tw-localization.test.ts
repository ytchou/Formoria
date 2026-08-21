import { describe, expect, it } from "vitest";
import {
  backfillCuratedProducts,
  buildCuratedProductPatches,
  buildExhibitorPatches,
  buildBrandPatches,
  localizeReputationSummary,
  type BackfillSupabase,
} from "./backfill-tw-localization";

/**
 * DEV-1543. The patch builders are pure, so they are tested directly; the only
 * I/O assertion here is the one that matters operationally — `--dry-run` must
 * build patches and issue no update.
 */

const BANNED = "質量";
const CORRECTED = "品質";
const BANNED_LINK = "鏈接";
const CORRECTED_LINK = "連結";

const PRODUCT_ID = "11111111-1111-1111-1111-111111111111";
const EXHIBITOR_ID = "33333333-3333-3333-3333-333333333333";
const BRAND_ID = "22222222-2222-2222-2222-222222222222";

describe("buildCuratedProductPatches", () => {
  it("builds a curated_products patch for a banned term", () => {
    const patches = buildCuratedProductPatches([
      {
        id: PRODUCT_ID,
        name_zh: `高${BANNED}保溫瓶`,
        product_description_zh: `官網有產品${BANNED_LINK}。`,
      },
    ]);

    expect(patches).toEqual([
      {
        id: PRODUCT_ID,
        patch: {
          name_zh: `高${CORRECTED}保溫瓶`,
          product_description_zh: `官網有產品${CORRECTED_LINK}。`,
        },
      },
    ]);
  });

  it("emits no patch for clean rows", () => {
    expect(
      buildCuratedProductPatches([
        {
          id: PRODUCT_ID,
          name_zh: `高${CORRECTED}保溫瓶`,
          product_description_zh: `官網有產品${CORRECTED_LINK}。`,
        },
      ]),
    ).toEqual([]);
  });
});

describe("buildExhibitorPatches", () => {
  it("builds an event_exhibitors patch", () => {
    const patches = buildExhibitorPatches([
      {
        id: EXHIBITOR_ID,
        summary_zh: `以${BANNED}見長的工作室。`,
        image_alt_zh: `攤位${BANNED_LINK}照片`,
      },
    ]);

    expect(patches).toEqual([
      {
        id: EXHIBITOR_ID,
        patch: {
          summary_zh: `以${CORRECTED}見長的工作室。`,
          image_alt_zh: `攤位${CORRECTED_LINK}照片`,
        },
      },
    ]);
  });
});

describe("reputation_summary", () => {
  it("covers textEn as well as text", () => {
    const result = localizeReputationSummary({
      text: `評價集中在${BANNED}。`,
      textEn: "Reviews call it YYDS.",
      sources: ["https://example.com"],
    });

    expect(result.changed).toBe(true);
    expect(result.value).toEqual({
      text: `評價集中在${CORRECTED}。`,
      textEn: "Reviews call it 太神了.",
      sources: ["https://example.com"],
    });
  });

  it("reaches reputation_summary through the brand patch builder", () => {
    const patches = buildBrandPatches([
      {
        id: BRAND_ID,
        name: "Formoria",
        description: null,
        blurb: null,
        reputation_summary: {
          text: `評價集中在${BANNED}。`,
          textEn: "Reviews call it YYDS.",
        },
      },
    ]);

    expect(patches).toHaveLength(1);
    expect(patches[0]?.patch.reputation_summary).toEqual({
      text: `評價集中在${CORRECTED}。`,
      textEn: "Reviews call it 太神了.",
    });
  });
});

describe("--dry-run", () => {
  it("produces patches and issues no update", async () => {
    const updateCalls: unknown[] = [];
    const client = {
      from: () => ({
        select: async () => ({
          data: [
            {
              id: PRODUCT_ID,
              name_zh: `高${BANNED}保溫瓶`,
              product_description_zh: `官網有產品${BANNED_LINK}。`,
            },
          ],
          error: null,
        }),
        update: (payload: unknown) => {
          updateCalls.push(payload);
          return { eq: async () => ({ error: null }) };
        },
      }),
    } as unknown as BackfillSupabase;

    const counts = await backfillCuratedProducts(client, { dryRun: true });

    expect(counts).toEqual({ updated: 1 });
    expect(updateCalls).toEqual([]);
  });
});
