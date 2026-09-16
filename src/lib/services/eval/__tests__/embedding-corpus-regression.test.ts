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
      anchor: { nameZh: "錨點", nameEn: "Anchor", category: "home" },
      a: { nameZh: "甲", nameEn: "Alpha", category: "home" },
      b: { nameZh: "乙", nameEn: "Beta", category: "home" },
      c: { nameZh: "丙", nameEn: "Gamma", category: "home" },
    },
    brands: {
      source: { name: "Source" },
      one: { name: "One" },
      two: { name: "Two" },
      three: { name: "Three" },
    },
    search: {
      en: {
        query: "English query",
        locale: "en",
        vector: ["a"],
        hybrid: ["a"],
      },
      zh: {
        query: "中文查詢",
        locale: "zh-TW",
        vector: ["a"],
        hybrid: ["a"],
      },
    },
    productNeighbours: { anchor: ["a", "b", "c"] },
    relatedBrands: { source: ["one", "two", "three"] },
    trails: { tea: ["a", "b", "c"] },
    trailLabels: { tea: "Tea trail" },
    ...overrides,
  };
}

describe("embedding corpus regression gates", () => {
  it("flags low-retention anchors and every changed trail for blind review", () => {
    const baseline = snapshot("baseline");
    const candidate = snapshot("candidate", {
      search: {
        en: {
          query: "English query",
          locale: "en",
          vector: ["b"],
          hybrid: ["a"],
        },
        zh: {
          query: "中文查詢",
          locale: "zh-TW",
          vector: ["a"],
          hybrid: ["a"],
        },
      },
      productNeighbours: { anchor: ["a", "c", "b"] },
      relatedBrands: { source: ["one", "two", "three"] },
      trails: { tea: ["a", "c", "b"] },
    });

    const overlap = compareConsumerOverlap(baseline, candidate);
    expect(overlap.changedTrails).toEqual(["tea"]);

    const pool = buildBlindReviewPool(baseline, candidate, overlap);
    expect(pool.some((item) => item.id === "search:en:a")).toBe(true);
    expect(pool.some((item) => item.id === "search:en:b")).toBe(true);
    expect(pool.some((item) => item.id === "trail:tea:a")).toBe(true);
    expect(pool.some((item) => item.domain === "related-brand")).toBe(false);
  });

  it("passes the three search gates when English improves and Chinese is stable", () => {
    const baseline = snapshot("baseline");
    const candidate = snapshot("candidate", {
      search: {
        en: {
          query: "English query",
          locale: "en",
          vector: ["b"],
          hybrid: ["a"],
        },
        zh: {
          query: "中文查詢",
          locale: "zh-TW",
          vector: ["a"],
          hybrid: ["a"],
        },
      },
    });
    const grades = new Map([
      ["search:en:a", 0],
      ["search:en:b", 3],
      ["search:zh:a", 3],
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
      trails: { tea: ["b", "c"] },
    });
    const grades = new Map([
      ["trail:tea:a", 3],
      ["trail:tea:b", 1],
      ["trail:tea:c", 0],
    ]);

    const result = evaluateReviewedAnchors(
      baseline,
      candidate,
      { productAnchors: [], brandAnchors: [], changedTrails: ["tea"] },
      grades,
    );

    expect(result).toEqual([
      {
        domain: "trail",
        anchor: "tea",
        baselineRelevance: 4,
        candidateRelevance: 1,
        passed: false,
      },
    ]);
  });
});

describe("blind grade trust policy", () => {
  it("uses automated grades only after all non-zero grades and 10% of zeros have human review", () => {
    const pool = Array.from({ length: 12 }, (_, index) => ({
      id: `search:q:item-${index}`,
      domain: "search" as const,
      anchor: "q",
      prompt: "query",
      candidate: `item-${index}`,
      candidateLabel: `Item ${index}`,
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
    expect(trusted.grades.get("search:q:item-11")).toBe(0);
  });

  it("requires complete human labels when weighted kappa is below 0.60", () => {
    const pool = ["a", "b", "c", "d"].map((candidate) => ({
      id: `search:q:${candidate}`,
      domain: "search" as const,
      anchor: "q",
      prompt: "query",
      candidate,
      candidateLabel: candidate,
    }));
    const incomplete: GradeRecord[] = [
      { id: "search:q:a", automatedGrade: 3, humanGrade: 0 },
      { id: "search:q:b", automatedGrade: 0 },
      { id: "search:q:c", automatedGrade: 3, humanGrade: 0 },
      { id: "search:q:d", automatedGrade: 0 },
    ];
    const reviewedZero = deterministicZeroSampleIds(incomplete)[0]!;
    incomplete.find((record) => record.id === reviewedZero)!.humanGrade = 3;

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
