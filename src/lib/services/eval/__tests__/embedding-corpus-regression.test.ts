import { describe, expect, it } from "vitest";

import {
  buildBlindReviewPool,
  compareConsumerOverlap,
  deterministicZeroSampleIds,
  evaluateReviewedAnchors,
  evaluateSearchGates,
  resolveTrustedGrades,
  weightedCohenKappa,
  type CorpusSnapshot,
  type GradeRecord,
} from "../embedding-corpus-regression";

const PRODUCT = {
  anchor: "quiet-home/walnut-nightstand",
  lamp: "atelier-luma/linen-lamp",
  tray: "mori-studio/oak-tray",
  cushion: "island-loom/indigo-cushion",
} as const;

const BRAND = {
  source: "quiet-home",
  lighting: "atelier-luma",
  woodwork: "mori-studio",
  textile: "island-loom",
} as const;

const REVIEW_CANDIDATES = [
  "atelier-luma/linen-lamp",
  "mori-studio/oak-tray",
  "island-loom/indigo-cushion",
  "quiet-home/walnut-nightstand",
  "paper-forest/brass-bookmark",
  "sea-glass-studio/recycled-vase",
  "mountain-tea/ceramic-teapot",
  "sunny-side/beeswax-candle",
  "little-carpenter/maple-puzzle",
  "field-notes/linen-journal",
  "moon-garden/silver-ring",
  "slow-stitch/canvas-tote",
] as const;

function snapshot(
  variant: "baseline" | "candidate",
  overrides: Partial<CorpusSnapshot> = {},
): CorpusSnapshot {
  return {
    schemaVersion: 1,
    variant,
    createdAt: "2026-09-16T00:00:00.000Z",
    corpusHealth: {
      eligibleProducts: 1,
      productEmbeddings: 1,
      missingProductEmbeddings: 0,
      staleProductEmbeddings: 0,
      orphanProductEmbeddings: 0,
      brandCentroids: 1,
      missingBrandCentroids: 0,
      staleBrandCentroids: 0,
      orphanBrandCentroids: 0,
    },
    products: {
      [PRODUCT.anchor]: {
        nameZh: "胡桃木床頭櫃",
        nameEn: "Walnut Nightstand",
        category: "home",
      },
      [PRODUCT.lamp]: {
        nameZh: "亞麻桌燈",
        nameEn: "Linen Table Lamp",
        category: "home",
      },
      [PRODUCT.tray]: {
        nameZh: "橡木托盤",
        nameEn: "Oak Tray",
        category: "home",
      },
      [PRODUCT.cushion]: {
        nameZh: "藍染靠枕",
        nameEn: "Indigo Cushion",
        category: "home",
      },
    },
    brands: {
      [BRAND.source]: { name: "靜居" },
      [BRAND.lighting]: { name: "Atelier Luma" },
      [BRAND.woodwork]: { name: "Mori Studio" },
      [BRAND.textile]: { name: "Island Loom" },
    },
    search: {
      en: {
        query: "warm light for a small reading corner",
        locale: "en",
        vector: [PRODUCT.lamp],
        hybrid: [PRODUCT.lamp],
      },
      zh: {
        query: "適合閱讀角落的暖光桌燈",
        locale: "zh-TW",
        vector: [PRODUCT.lamp],
        hybrid: [PRODUCT.lamp],
      },
    },
    productNeighbours: {
      [PRODUCT.anchor]: [PRODUCT.lamp, PRODUCT.tray, PRODUCT.cushion],
    },
    relatedBrands: {
      [BRAND.source]: [BRAND.lighting, BRAND.woodwork, BRAND.textile],
    },
    trails: {
      "small-space-reading-corner": [
        PRODUCT.lamp,
        PRODUCT.tray,
        PRODUCT.cushion,
      ],
    },
    trailLabels: { "small-space-reading-corner": "小空間閱讀角落" },
    ...overrides,
  };
}

describe("embedding corpus regression gates", () => {
  it("flags low-retention anchors and every changed trail for blind review", () => {
    const baseline = snapshot("baseline");
    const candidate = snapshot("candidate", {
      search: {
        en: {
          query: "warm light for a small reading corner",
          locale: "en",
          vector: [PRODUCT.tray],
          hybrid: [PRODUCT.lamp],
        },
        zh: {
          query: "適合閱讀角落的暖光桌燈",
          locale: "zh-TW",
          vector: [PRODUCT.lamp],
          hybrid: [PRODUCT.lamp],
        },
      },
      productNeighbours: {
        [PRODUCT.anchor]: [PRODUCT.lamp, PRODUCT.cushion, PRODUCT.tray],
      },
      relatedBrands: {
        [BRAND.source]: [BRAND.lighting, BRAND.woodwork, BRAND.textile],
      },
      trails: {
        "small-space-reading-corner": [
          PRODUCT.lamp,
          PRODUCT.cushion,
          PRODUCT.tray,
        ],
      },
    });

    const overlap = compareConsumerOverlap(baseline, candidate);
    expect(overlap.changedTrails).toEqual(["small-space-reading-corner"]);

    const pool = buildBlindReviewPool(baseline, candidate, overlap);
    expect(pool.some((item) => item.id === `search:en:${PRODUCT.lamp}`)).toBe(
      true,
    );
    expect(pool.some((item) => item.id === `search:en:${PRODUCT.tray}`)).toBe(
      true,
    );
    expect(
      pool.some(
        (item) =>
          item.id === `trail:small-space-reading-corner:${PRODUCT.lamp}`,
      ),
    ).toBe(true);
    expect(pool.some((item) => item.domain === "related-brand")).toBe(false);
  });

  it("passes the three search gates when English improves and Chinese is stable", () => {
    const baseline = snapshot("baseline");
    const candidate = snapshot("candidate", {
      search: {
        en: {
          query: "warm light for a small reading corner",
          locale: "en",
          vector: [PRODUCT.tray],
          hybrid: [PRODUCT.lamp],
        },
        zh: {
          query: "適合閱讀角落的暖光桌燈",
          locale: "zh-TW",
          vector: [PRODUCT.lamp],
          hybrid: [PRODUCT.lamp],
        },
      },
    });
    const grades = new Map([
      [`search:en:${PRODUCT.lamp}`, 0],
      [`search:en:${PRODUCT.tray}`, 3],
      [`search:zh:${PRODUCT.lamp}`, 3],
    ]);

    const result = evaluateSearchGates(baseline, candidate, grades);

    expect(result.englishVectorDelta).toBe(1);
    expect(result.englishHybridDelta).toBe(0);
    expect(result.chineseHybridDelta).toBe(0);
    expect(result.passed).toBe(true);
  });

  it("fails reviewed downstream anchors whose candidate relevance decreases", () => {
    const baseline = snapshot("baseline");
    const candidate = snapshot("candidate", {
      trails: {
        "small-space-reading-corner": [PRODUCT.tray, PRODUCT.cushion],
      },
    });
    const grades = new Map([
      [`trail:small-space-reading-corner:${PRODUCT.lamp}`, 3],
      [`trail:small-space-reading-corner:${PRODUCT.tray}`, 1],
      [`trail:small-space-reading-corner:${PRODUCT.cushion}`, 0],
    ]);

    const result = evaluateReviewedAnchors(
      baseline,
      candidate,
      {
        productAnchors: [],
        brandAnchors: [],
        changedTrails: ["small-space-reading-corner"],
      },
      grades,
    );

    expect(result).toEqual([
      {
        domain: "trail",
        anchor: "small-space-reading-corner",
        baselineRelevance: 4,
        candidateRelevance: 1,
        passed: false,
      },
    ]);
  });
});

describe("blind grade trust policy", () => {
  it("uses automated grades only after all non-zero grades and 10% of zeros have human review", () => {
    const pool = REVIEW_CANDIDATES.map((candidate) => ({
      id: `search:reading-corner:${candidate}`,
      domain: "search" as const,
      anchor: "reading-corner",
      prompt: "warm light for a small reading corner",
      candidate,
      candidateLabel: candidate,
    }));
    const records: GradeRecord[] = pool.map((item, index) => ({
      id: item.id,
      automatedGrade: index < 2 ? 3 : 0,
    }));
    const zeroSample = deterministicZeroSampleIds(records);
    for (const record of records) {
      if (record.automatedGrade !== 0 || zeroSample.includes(record.id)) {
        record.humanGrade = record.automatedGrade;
      }
    }

    const trusted = resolveTrustedGrades(pool, records);

    expect(trusted.mode).toBe("automated");
    expect(trusted.kappa).toBe(1);
    expect(
      trusted.grades.get(`search:reading-corner:${REVIEW_CANDIDATES[11]}`),
    ).toBe(0);
  });

  it("requires complete human labels when weighted kappa is below 0.60", () => {
    const candidates = REVIEW_CANDIDATES.slice(0, 4);
    const pool = candidates.map((candidate) => ({
      id: `search:reading-corner:${candidate}`,
      domain: "search" as const,
      anchor: "reading-corner",
      prompt: "warm light for a small reading corner",
      candidate,
      candidateLabel: candidate,
    }));
    const incomplete: GradeRecord[] = [
      {
        id: `search:reading-corner:${REVIEW_CANDIDATES[0]}`,
        automatedGrade: 3,
        humanGrade: 0,
      },
      {
        id: `search:reading-corner:${REVIEW_CANDIDATES[1]}`,
        automatedGrade: 0,
      },
      {
        id: `search:reading-corner:${REVIEW_CANDIDATES[2]}`,
        automatedGrade: 3,
        humanGrade: 0,
      },
      {
        id: `search:reading-corner:${REVIEW_CANDIDATES[3]}`,
        automatedGrade: 0,
      },
    ];
    const [reviewedZero] = deterministicZeroSampleIds(incomplete);
    expect(reviewedZero).toBeDefined();
    const reviewedRecord = incomplete.find(
      (record) => record.id === reviewedZero,
    );
    expect(reviewedRecord).toBeDefined();
    if (!reviewedRecord) throw new Error("Expected deterministic zero sample");
    reviewedRecord.humanGrade = 3;

    expect(weightedCohenKappa([3, 0, 3], [0, 3, 0])).toBeLessThan(0.6);
    expect(() => resolveTrustedGrades(pool, incomplete)).toThrow(
      /complete human labels/,
    );

    const complete = incomplete.map((record) => ({
      ...record,
      humanGrade: record.humanGrade ?? 3,
    }));
    expect(resolveTrustedGrades(pool, complete).mode).toBe("human");
  });
});
