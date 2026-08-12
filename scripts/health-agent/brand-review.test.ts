import { describe, expect, it } from "vitest";

import { evaluateBrandReview, type RecentBrandEdit } from "./brand-review";

const NOW_ISO = "2026-07-23T12:00:00.000Z";
const WINDOW_START_ISO = "2026-07-22T12:00:00.000Z";

const CJK_PARAGRAPH =
  "海漂計畫以台灣海岸線回收的漂流材料製作模組化包款，外殼採用耐用的再生帆布，並搭配可自由調整的背帶系統，讓同一個包身能夠依照通勤、旅行或週末外出的需求重新組合，不必為每個場合另外購買一個包。";
// 4 CJK characters inside ~300 non-whitespace characters of English prose:
// a correct EN description that names the brand in its native script.
const EN_PARAGRAPH_WITH_BRAND_NAME =
  "Entadar 海漂計畫 designs modular bags from reclaimed ocean drift materials collected along the coastline of Taiwan, pairing a durable recycled canvas shell with a modular strap system so that one body can be reconfigured for commuting, travel, or weekend use without buying a separate product for each occasion.";

function brand(overrides: Partial<RecentBrandEdit> = {}): RecentBrandEdit {
  return {
    id: "brand-1",
    name: "Test Brand",
    description: null,
    descriptionEn: null,
    mitStatus: null,
    mitDeclaredScope: null,
    mitDeclaredAt: null,
    mitVerifiedAt: null,
    purchaseWebsite: "https://example.com/",
    purchasePinkoi: null,
    purchaseShopee: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    otherUrls: null,
    ...overrides,
  };
}

describe("evaluateBrandReview", () => {
  it("evaluates empty input", () => {
    const result = evaluateBrandReview([], NOW_ISO, WINDOW_START_ISO);

    expect(result.findings).toHaveLength(0);
    expect(result.snapshot).toEqual({
      reviewedCount: 0,
      findingCount: 0,
      windowStartIso: WINDOW_START_ISO,
      nowIso: NOW_ISO,
    });
  });

  it("flags declared MIT without scope", () => {
    const result = evaluateBrandReview(
      [
        brand({
          mitStatus: "declared",
          mitDeclaredScope: null,
          mitDeclaredAt: "2026-01-01",
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "medium",
      title: "MIT declared without scope",
      evidence: {
        brandId: "brand-1",
        brandName: "Test Brand",
        mitStatus: "declared",
      },
      mergePolicy: "human",
      source: "directory",
    });
    expect(result.findings[0]?.fingerprint).toContain(
      "brand-review-mit-consistency",
    );
  });

  it("flags declared MIT without date", () => {
    const result = evaluateBrandReview(
      [
        brand({
          mitStatus: "declared",
          mitDeclaredScope: "all",
          mitDeclaredAt: null,
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "medium",
      title: "MIT declared without date",
    });
  });

  it("flags verified MIT without evidence", () => {
    const result = evaluateBrandReview(
      [brand({ mitStatus: "verified", mitVerifiedAt: null })],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "medium",
      title: "MIT verified without evidence",
    });
  });

  it("skips unverified MIT", () => {
    const result = evaluateBrandReview(
      [brand({ mitStatus: "unverified" })],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(0);
  });

  it("flags description language swap with CJK in the EN field", () => {
    const result = evaluateBrandReview(
      [
        brand({
          description: "pure english",
          descriptionEn: "這是中文描述",
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "low",
      title: "Description language may be swapped (CJK in EN field)",
      evidence: {
        brandId: "brand-1",
        brandName: "Test Brand",
        descriptionCjkCount: 0,
        descriptionEnCjkCount: 6,
      },
    });
  });

  it("flags CJK in both description fields", () => {
    const result = evaluateBrandReview(
      [
        brand({
          description: "品牌中文介紹內容",
          descriptionEn: "這是一個中文描述",
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "low",
      title: "EN description contains CJK characters",
    });
  });

  it("skips matching language descriptions", () => {
    const result = evaluateBrandReview(
      [brand({ description: "品牌介紹", descriptionEn: "Brand intro" })],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(0);
  });

  it("skips an EN description that only embeds the native-script brand name", () => {
    const result = evaluateBrandReview(
      [
        brand({
          description: CJK_PARAGRAPH,
          descriptionEn: EN_PARAGRAPH_WITH_BRAND_NAME,
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(0);
  });

  it("flags a genuinely swapped EN description", () => {
    const result = evaluateBrandReview(
      [brand({ description: CJK_PARAGRAPH, descriptionEn: CJK_PARAGRAPH })],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "low",
      title: "EN description contains CJK characters",
    });
  });

  it("flags excessive domain diversity", () => {
    const result = evaluateBrandReview(
      [
        brand({
          purchaseWebsite: "https://one.example",
          socialInstagram: "https://two.example/account",
          socialThreads: "https://three.example/account",
          socialFacebook: "https://four.example/account",
          otherUrls: [
            { label: "Five", url: "https://five.example" },
            { label: "Six", url: "https://six.example" },
          ],
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "medium",
      title: "Excessive domain diversity",
      evidence: { domainCount: 6 },
    });
  });

  it("extracts URLs from otherUrls JSONB objects", () => {
    const result = evaluateBrandReview(
      [
        brand({
          purchaseWebsite: "https://www.one.example",
          socialInstagram: "https://two.example",
          socialThreads: "https://three.example",
          socialFacebook: "https://four.example",
          otherUrls: [
            { label: "Five", url: "https://five.example/path" },
            { label: "Six", url: "https://six.example/path" },
          ],
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.evidence).toEqual({
      brandId: "brand-1",
      brandName: "Test Brand",
      domainCount: 6,
      domains: [
        "five.example",
        "four.example",
        "one.example",
        "six.example",
        "three.example",
        "two.example",
      ],
    });
  });

  it("skips five or fewer domains", () => {
    const result = evaluateBrandReview(
      [
        brand({
          purchaseWebsite: "https://one.example",
          socialInstagram: "https://two.example",
          socialThreads: "https://three.example",
          socialFacebook: "https://four.example",
          otherUrls: [{ label: "Five", url: "https://five.example" }],
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(0);
  });

  it("flags a self-referential formoria.com URL", () => {
    const result = evaluateBrandReview(
      [brand({ purchaseWebsite: "https://formoria.com/brands/test-brand" })],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "low",
      title: "Self-referential formoria.com URL",
      evidence: {
        brandId: "brand-1",
        brandName: "Test Brand",
        matchedUrl: "https://formoria.com/brands/test-brand",
      },
    });
  });

  it("flags the www.formoria.com variant", () => {
    const result = evaluateBrandReview(
      [brand({ socialFacebook: "https://www.formoria.com/brand/test" })],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Self-referential formoria.com URL");
  });

  it("skips non-formoria URLs", () => {
    const result = evaluateBrandReview(
      [
        brand({
          purchaseWebsite: "https://example.com",
          otherUrls: [{ label: "Store", url: "not a valid URL" }],
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(0);
  });

  it("aggregates multiple findings per brand", () => {
    const result = evaluateBrandReview(
      [
        brand({
          mitStatus: "declared",
          mitDeclaredScope: null,
          mitDeclaredAt: "2026-01-01",
          description: "pure english",
          descriptionEn: "這是中文描述",
          purchaseWebsite: "https://formoria.com/brand/test",
          socialInstagram: "https://two.example",
          socialThreads: "https://three.example",
          socialFacebook: "https://four.example",
          otherUrls: [
            { label: "Five", url: "https://five.example" },
            { label: "Six", url: "https://six.example" },
          ],
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(4);
    expect(result.snapshot.findingCount).toBe(4);
  });

  it("accepts a legitimate deep purchase destination", () => {
    const result = evaluateBrandReview(
      [
        brand({
          name: "虎嚕吼嚕嚕 HOORU HORURU",
          purchaseWebsite: "https://portaly.cc/HOORU.HORURU",
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(0);
  });

  it("flags a third-party directory URL", () => {
    const result = evaluateBrandReview(
      [brand({ purchaseWebsite: "https://twrr.org.tw/partners/brand-x" })],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "medium",
      title: "purchase_website points at a third-party directory",
    });
    expect(result.findings[0]?.title).not.toBe(
      "purchase_website is not a root URL",
    );
  });

  it("flags a social URL in purchase_website", () => {
    const result = evaluateBrandReview(
      [brand({ purchaseWebsite: "https://www.threads.com/@brand" })],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "medium",
      title: "purchase_website holds a social URL",
    });
  });

  it("produces no finding for root purchase_website URLs", () => {
    const resultTrailingSlash = evaluateBrandReview(
      [brand({ purchaseWebsite: "https://brand.example/" })],
      NOW_ISO,
      WINDOW_START_ISO,
    );
    expect(resultTrailingSlash.findings).toHaveLength(0);

    const resultBare = evaluateBrandReview(
      [brand({ purchaseWebsite: "https://brand.example" })],
      NOW_ISO,
      WINDOW_START_ISO,
    );
    expect(resultBare.findings).toHaveLength(0);
  });

  it("reports a self-referential purchase_website once", () => {
    const result = evaluateBrandReview(
      [brand({ purchaseWebsite: "https://formoria.com/brands/test-brand" })],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      title: "Self-referential formoria.com URL",
    });
  });

  it("flags a brand with no usable visit CTA", () => {
    const result = evaluateBrandReview(
      [brand({ purchaseWebsite: null })],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "medium",
      title: "Brand has no usable visit CTA",
      evidence: {
        brandId: "brand-1",
        brandName: "Test Brand",
      },
    });
    expect(result.findings[0]?.fingerprint).toContain(
      "brand-review-visit-cta-disabled",
    );
  });

  it("skips a brand whose only channel is purchase_pinkoi", () => {
    const result = evaluateBrandReview(
      [
        brand({
          purchaseWebsite: null,
          purchasePinkoi: "https://www.pinkoi.com/store/warmwood",
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(0);
  });

  it("skips a brand whose only channel is a bare Instagram handle", () => {
    const result = evaluateBrandReview(
      [brand({ purchaseWebsite: null, socialInstagram: "@warmwood" })],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(0);
  });

  it("flags a non-http purchase_website as an unusable visit CTA", () => {
    const result = evaluateBrandReview(
      [brand({ purchaseWebsite: "mailto:hi@brand.com" })],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings.map((finding) => finding.title)).toContain(
      "Brand has no usable visit CTA",
    );
  });

  it("flags a brand whose only URLs live in otherUrls", () => {
    const result = evaluateBrandReview(
      [
        brand({
          purchaseWebsite: null,
          otherUrls: [{ label: "Store", url: "https://shop.example" }],
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Brand has no usable visit CTA");
  });

  it("deduplicates fingerprints across brands", () => {
    const result = evaluateBrandReview(
      [
        brand({
          id: "brand-1",
          mitStatus: "declared",
          mitDeclaredScope: null,
          mitDeclaredAt: "2026-01-01",
        }),
        brand({
          id: "brand-2",
          name: "Second Brand",
          mitStatus: "declared",
          mitDeclaredScope: null,
          mitDeclaredAt: "2026-01-01",
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    );

    const fingerprints = result.findings.map((finding) => finding.fingerprint);
    expect(fingerprints).toHaveLength(2);
    expect(new Set(fingerprints).size).toBe(2);
  });
});
