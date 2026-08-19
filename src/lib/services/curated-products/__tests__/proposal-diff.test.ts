import { describe, expect, it } from "vitest";

import {
  diffCuratedProductProposals,
  type ExistingCuratedProduct,
} from "../proposal-diff";
import type { CuratedProductProposal } from "@/lib/types/enriched-data";

/**
 * Realistic fixtures on purpose: the diff keys are a name-derived slug and a
 * product URL, and both only misbehave on the shapes real data has — a CJK name
 * transliterated into a slug, a `www.` host, a `utm_*` query string a copied
 * link carries.
 */
function proposal(
  overrides: Partial<CuratedProductProposal> = {},
): CuratedProductProposal {
  return {
    key: "chai-shao-shou-kan-ma-ko-pei",
    nameZh: "柴燒手感馬克杯",
    nameEn: "Wood-fired Mug",
    category: "crafts",
    subcategories: ["ceramics"],
    material: ["ceramic"],
    officialUrl: "https://taoqi.com.tw/products/wood-fired-mug",
    productDescriptionZh:
      "南投柴燒窯場燒製的馬克杯，杯身留有落灰痕跡，每一只的顏色都不同。",
    sources: [
      {
        url: "https://taoqi.com.tw/products/wood-fired-mug",
        sourceType: "official",
      },
    ],
    ...overrides,
  };
}

function existingRow(
  overrides: Partial<ExistingCuratedProduct> = {},
): ExistingCuratedProduct {
  return {
    key: "chai-shao-shou-kan-ma-ko-pei",
    officialUrl: "https://taoqi.com.tw/products/wood-fired-mug",
    visible: true,
    ...overrides,
  };
}

describe("curated product proposal diff", () => {
  it("matches_existing_row_on_official_url_first — a renamed product still resolves to its own row", () => {
    // The row was renamed after it was created, so its key no longer derives
    // from the name the run just proposed. A *different* row's key does — and
    // it is a rejection, so a key-first diff would report the wrong state.
    const renamed = existingRow({
      key: "ching-yu-ma-ko-pei",
      officialUrl: "https://taoqi.com.tw/products/wood-fired-mug",
      visible: true,
    });
    const unrelatedRejection = existingRow({
      key: "chai-shao-shou-kan-ma-ko-pei",
      officialUrl: "https://taoqi.com.tw/products/discontinued-mug",
      visible: false,
    });

    const [diff] = diffCuratedProductProposals(
      [proposal()],
      [unrelatedRejection, renamed],
    );

    expect(diff?.state).toBe("matched");
    expect(diff?.existing).toBe(renamed);
  });

  it("falls_back_to_key_when_url_is_absent — the key carries the diff when the URL cannot", () => {
    const row = existingRow({ officialUrl: null });

    const [absentUrl] = diffCuratedProductProposals(
      [proposal({ officialUrl: "" })],
      [row],
    );
    expect(absentUrl?.state).toBe("matched");
    expect(absentUrl?.existing).toBe(row);

    // Same fallback when the URL is present but names a page no row holds:
    // a brand that moved its shop to a new platform re-links every product.
    const [movedUrl] = diffCuratedProductProposals(
      [proposal({ officialUrl: "https://taoqi.myshopify.com/products/mug" })],
      [row],
    );
    expect(movedUrl?.state).toBe("matched");
    expect(movedUrl?.existing).toBe(row);
  });

  it("normalizes_url_before_comparing — a trailing slash, a query string and www. are noise", () => {
    // Keys deliberately disagree, so only the URL comparison can match here.
    const row = existingRow({
      key: "a-key-that-does-not-match",
      officialUrl:
        "https://www.taoqi.com.tw/products/wood-fired-mug/?utm_source=newsletter",
    });

    const [diff] = diffCuratedProductProposals(
      [
        proposal({
          officialUrl: "https://taoqi.com.tw/products/wood-fired-mug",
        }),
      ],
      [row],
    );

    expect(diff?.state).toBe("matched");
    expect(diff?.existing).toBe(row);
  });

  it("marks_a_rejected_product_as_known — a hidden row is rejection memory, not a new proposal", () => {
    const rejected = existingRow({ visible: false });

    const [diff] = diffCuratedProductProposals([proposal()], [rejected]);

    expect(diff?.state).toBe("previously-rejected");
    expect(diff?.state).not.toBe("new");
    expect(diff?.existing).toBe(rejected);
  });

  it("marks_a_genuinely_new_product_as_new — no false positives from another product's row", () => {
    const other = existingRow({
      key: "chu-pien-shou-chih-to-pan",
      officialUrl: "https://taoqi.com.tw/products/bamboo-tray",
      visible: true,
    });

    const diffs = diffCuratedProductProposals([proposal()], [other]);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.state).toBe("new");
    expect(diffs[0]?.existing).toBeNull();
    expect(diffs[0]?.proposal.nameZh).toBe("柴燒手感馬克杯");
  });

  it("reports one diff per proposal, in the order they were proposed", () => {
    const proposals = [
      proposal(),
      proposal({
        key: "chu-pien-shou-chih-to-pan",
        nameZh: "竹編手織托盤",
        officialUrl: "https://taoqi.com.tw/products/bamboo-tray",
      }),
    ];

    const diffs = diffCuratedProductProposals(proposals, [
      existingRow({ visible: false }),
    ]);

    expect(diffs.map((diff) => diff.state)).toEqual([
      "previously-rejected",
      "new",
    ]);
    expect(diffs.map((diff) => diff.proposal.key)).toEqual(
      proposals.map((item) => item.key),
    );
  });

  it("reports every proposal as new when the brand has no products yet", () => {
    const diffs = diffCuratedProductProposals([proposal()], []);

    expect(diffs).toEqual([
      {
        proposal: expect.objectContaining({ key: proposal().key }),
        state: "new",
        existing: null,
      },
    ]);
  });
});
