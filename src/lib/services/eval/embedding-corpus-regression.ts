import { createHash } from "node:crypto";

import { mean, ndcgAtK } from "./scorers";

export type SnapshotVariant = "baseline" | "candidate";
export type ProductLabel = {
  nameZh: string;
  nameEn: string | null;
  category: string;
};
export type BrandLabel = { name: string };
export type SearchSnapshot = {
  query: string;
  locale: "zh-TW" | "en";
  vector: string[];
  hybrid: string[];
};
export type CorpusHealth = {
  eligibleProducts: number;
  productEmbeddings: number;
  missingProductEmbeddings: number;
  staleProductEmbeddings: number;
  orphanProductEmbeddings: number;
  brandCentroids: number;
  missingBrandCentroids: number;
  staleBrandCentroids: number;
  orphanBrandCentroids: number;
};
export type CorpusSnapshot = {
  schemaVersion: 1;
  variant: SnapshotVariant;
  createdAt: string;
  corpusHealth: CorpusHealth;
  products: Record<string, ProductLabel>;
  brands: Record<string, BrandLabel>;
  search: Record<string, SearchSnapshot>;
  productNeighbours: Record<string, string[]>;
  relatedBrands: Record<string, string[]>;
  trails: Record<string, string[]>;
  trailLabels: Record<string, string>;
};

export type ConsumerOverlap = {
  productMeanOverlap: number;
  productRetentionRate: number;
  brandMeanOverlap: number;
  brandRetentionRate: number;
  trailMinimumOverlap: number;
  productAnchors: string[];
  brandAnchors: string[];
  changedTrails: string[];
  passed: boolean;
};

export type BlindReviewItem = {
  id: string;
  domain: "search" | "product-neighbour" | "related-brand" | "trail";
  anchor: string;
  prompt: string;
  candidate: string;
  candidateLabel: string;
};

export type GradeRecord = {
  id: string;
  automatedGrade?: number;
  humanGrade?: number;
};

function overlapCount(
  left: readonly string[],
  right: readonly string[],
): number {
  const rightSet = new Set(right);
  return new Set(left.filter((item) => rightSet.has(item))).size;
}

function recordKeys<T>(
  left: Record<string, T>,
  right: Record<string, T>,
): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
}

export function compareConsumerOverlap(
  baseline: CorpusSnapshot,
  candidate: CorpusSnapshot,
): ConsumerOverlap {
  const productKeys = recordKeys(
    baseline.productNeighbours,
    candidate.productNeighbours,
  );
  const productOverlaps = productKeys.map((anchor) => ({
    anchor,
    overlap: overlapCount(
      baseline.productNeighbours[anchor] ?? [],
      candidate.productNeighbours[anchor] ?? [],
    ),
  }));

  const brandKeys = recordKeys(baseline.relatedBrands, candidate.relatedBrands);
  const brandOverlaps = brandKeys.map((anchor) => ({
    anchor,
    overlap: overlapCount(
      baseline.relatedBrands[anchor] ?? [],
      candidate.relatedBrands[anchor] ?? [],
    ),
  }));

  const trailKeys = recordKeys(baseline.trails, candidate.trails);
  const trailOverlaps = trailKeys.map((anchor) => ({
    anchor,
    overlap: overlapCount(
      baseline.trails[anchor] ?? [],
      candidate.trails[anchor] ?? [],
    ),
  }));
  const changedTrails = trailKeys.filter(
    (anchor) =>
      JSON.stringify(baseline.trails[anchor] ?? []) !==
      JSON.stringify(candidate.trails[anchor] ?? []),
  );

  const productMeanOverlap = mean(productOverlaps.map((item) => item.overlap));
  const productRetentionRate = productOverlaps.length
    ? productOverlaps.filter((item) => item.overlap >= 3).length /
      productOverlaps.length
    : 0;
  const brandMeanOverlap = mean(brandOverlaps.map((item) => item.overlap));
  const brandRetentionRate = brandOverlaps.length
    ? brandOverlaps.filter((item) => item.overlap >= 2).length /
      brandOverlaps.length
    : 0;
  const trailMinimumOverlap = trailOverlaps.length
    ? Math.min(...trailOverlaps.map((item) => item.overlap))
    : 0;

  return {
    productMeanOverlap,
    productRetentionRate,
    brandMeanOverlap,
    brandRetentionRate,
    trailMinimumOverlap,
    productAnchors: productOverlaps
      .filter((item) => item.overlap < 3)
      .map((item) => item.anchor),
    brandAnchors: brandOverlaps
      .filter((item) => item.overlap < 2)
      .map((item) => item.anchor),
    changedTrails,
    passed:
      productMeanOverlap >= 4 &&
      productRetentionRate >= 0.95 &&
      brandMeanOverlap >= 3 &&
      brandRetentionRate >= 0.95 &&
      trailOverlaps.length > 0 &&
      trailMinimumOverlap >= 4,
  };
}

function productLabel(
  snapshot: CorpusSnapshot,
  stableId: string,
): string | null {
  const product = snapshot.products[stableId];
  if (!product) return null;
  return [product.nameZh, product.nameEn].filter(Boolean).join(" / ");
}

function addPoolItems(
  items: Map<string, BlindReviewItem>,
  domain: BlindReviewItem["domain"],
  anchor: string,
  prompt: string,
  candidates: readonly string[],
  label: (candidate: string) => string,
): void {
  for (const candidate of new Set(candidates)) {
    const id = `${domain}:${anchor}:${candidate}`;
    items.set(id, {
      id,
      domain,
      anchor,
      prompt,
      candidate,
      candidateLabel: label(candidate),
    });
  }
}

export function buildBlindReviewPool(
  baseline: CorpusSnapshot,
  candidate: CorpusSnapshot,
  overlap = compareConsumerOverlap(baseline, candidate),
): BlindReviewItem[] {
  const items = new Map<string, BlindReviewItem>();

  for (const queryId of recordKeys(baseline.search, candidate.search)) {
    const before = baseline.search[queryId];
    const after = candidate.search[queryId];
    const query = before ?? after;
    if (!query) continue;
    addPoolItems(
      items,
      "search",
      queryId,
      query.query,
      [
        ...(before?.vector ?? []),
        ...(before?.hybrid ?? []),
        ...(after?.vector ?? []),
        ...(after?.hybrid ?? []),
      ],
      (stableId) =>
        productLabel(baseline, stableId) ??
        productLabel(candidate, stableId) ??
        stableId,
    );
  }

  for (const anchor of overlap.productAnchors) {
    addPoolItems(
      items,
      "product-neighbour",
      anchor,
      productLabel(baseline, anchor) ??
        productLabel(candidate, anchor) ??
        anchor,
      [
        ...(baseline.productNeighbours[anchor] ?? []),
        ...(candidate.productNeighbours[anchor] ?? []),
      ],
      (stableId) =>
        productLabel(baseline, stableId) ??
        productLabel(candidate, stableId) ??
        stableId,
    );
  }

  for (const anchor of overlap.brandAnchors) {
    addPoolItems(
      items,
      "related-brand",
      anchor,
      baseline.brands[anchor]?.name ?? anchor,
      [
        ...(baseline.relatedBrands[anchor] ?? []),
        ...(candidate.relatedBrands[anchor] ?? []),
      ],
      (slug) =>
        baseline.brands[slug]?.name ?? candidate.brands[slug]?.name ?? slug,
    );
  }

  for (const anchor of overlap.changedTrails) {
    addPoolItems(
      items,
      "trail",
      anchor,
      baseline.trailLabels[anchor] ?? candidate.trailLabels[anchor] ?? anchor,
      [...(baseline.trails[anchor] ?? []), ...(candidate.trails[anchor] ?? [])],
      (stableId) =>
        productLabel(baseline, stableId) ??
        productLabel(candidate, stableId) ??
        stableId,
    );
  }

  return [...items.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function assertGrade(
  value: number | undefined,
  label: string,
): asserts value is number {
  if (!Number.isInteger(value) || value! < 0 || value! > 3) {
    throw new Error(`${label} must be an integer from 0 to 3`);
  }
}

export function weightedCohenKappa(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length !== right.length || left.length === 0) {
    throw new Error(
      "Weighted kappa requires two non-empty equal-length grade lists",
    );
  }
  const countsLeft = [0, 0, 0, 0];
  const countsRight = [0, 0, 0, 0];
  let observedDisagreement = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    assertGrade(a, `left grade ${index}`);
    assertGrade(b, `right grade ${index}`);
    countsLeft[a] += 1;
    countsRight[b] += 1;
    observedDisagreement += ((a - b) / 3) ** 2;
  }
  observedDisagreement /= left.length;

  let expectedDisagreement = 0;
  for (let a = 0; a <= 3; a += 1) {
    for (let b = 0; b <= 3; b += 1) {
      expectedDisagreement +=
        (((a - b) / 3) ** 2 * countsLeft[a]! * countsRight[b]!) /
        left.length ** 2;
    }
  }
  if (expectedDisagreement === 0) {
    return observedDisagreement === 0 ? 1 : 0;
  }
  return 1 - observedDisagreement / expectedDisagreement;
}

export function deterministicZeroSampleIds(
  records: readonly GradeRecord[],
): string[] {
  const zeros = records
    .filter((record) => record.automatedGrade === 0)
    .map((record) => ({
      id: record.id,
      hash: createHash("sha256").update(record.id).digest("hex"),
    }))
    .sort((left, right) => left.hash.localeCompare(right.hash));
  return zeros.slice(0, Math.ceil(zeros.length * 0.1)).map((item) => item.id);
}

export function resolveTrustedGrades(
  pool: readonly BlindReviewItem[],
  records: readonly GradeRecord[],
): {
  grades: Map<string, number>;
  mode: "automated" | "human";
  kappa: number | null;
} {
  const byId = new Map<string, GradeRecord>();
  for (const record of records) {
    if (byId.has(record.id))
      throw new Error(`Duplicate grade record: ${record.id}`);
    if (record.automatedGrade !== undefined) {
      assertGrade(record.automatedGrade, `${record.id} automatedGrade`);
    }
    if (record.humanGrade !== undefined) {
      assertGrade(record.humanGrade, `${record.id} humanGrade`);
    }
    byId.set(record.id, record);
  }

  const poolRecords = pool.map((item) => {
    const record = byId.get(item.id);
    if (!record) throw new Error(`Missing grade record: ${item.id}`);
    return record;
  });
  const allHuman = poolRecords.every(
    (record) => record.humanGrade !== undefined,
  );
  const allAutomated = poolRecords.every(
    (record) => record.automatedGrade !== undefined,
  );
  if (!allAutomated) {
    if (!allHuman) throw new Error("Complete human labels are required");
    return {
      grades: new Map(
        poolRecords.map((record) => [record.id, record.humanGrade!]),
      ),
      mode: "human",
      kappa: null,
    };
  }

  const requiredHuman = new Set([
    ...poolRecords
      .filter((record) => record.automatedGrade! > 0)
      .map((record) => record.id),
    ...deterministicZeroSampleIds(poolRecords),
  ]);
  for (const id of requiredHuman) {
    if (byId.get(id)?.humanGrade === undefined) {
      throw new Error(`Human review is required for ${id}`);
    }
  }

  const reviewed = poolRecords.filter((record) => requiredHuman.has(record.id));
  const kappa = weightedCohenKappa(
    reviewed.map((record) => record.automatedGrade!),
    reviewed.map((record) => record.humanGrade!),
  );
  if (kappa < 0.6) {
    if (!allHuman) {
      throw new Error(
        `Weighted kappa ${kappa.toFixed(3)} is below 0.60; complete human labels are required`,
      );
    }
    return {
      grades: new Map(
        poolRecords.map((record) => [record.id, record.humanGrade!]),
      ),
      mode: "human",
      kappa,
    };
  }

  return {
    grades: new Map(
      poolRecords.map((record) => [
        record.id,
        record.humanGrade ?? record.automatedGrade!,
      ]),
    ),
    mode: "automated",
    kappa,
  };
}

function searchGrades(
  queryId: string,
  grades: ReadonlyMap<string, number>,
): Array<{ key: string; grade: number }> {
  const prefix = `search:${queryId}:`;
  return [...grades.entries()]
    .filter(([id]) => id.startsWith(prefix))
    .map(([id, grade]) => ({ key: id.slice(prefix.length), grade }));
}

function meanNdcg(
  snapshot: CorpusSnapshot,
  locale: "zh-TW" | "en",
  arm: "vector" | "hybrid",
  grades: ReadonlyMap<string, number>,
): number {
  const values = Object.entries(snapshot.search)
    .filter(([, item]) => item.locale === locale)
    .map(([queryId, item]) =>
      ndcgAtK(item[arm], searchGrades(queryId, grades), 10),
    );
  if (values.length === 0)
    throw new Error(`Snapshot has no ${locale} search queries`);
  return mean(values);
}

export function evaluateSearchGates(
  baseline: CorpusSnapshot,
  candidate: CorpusSnapshot,
  grades: ReadonlyMap<string, number>,
) {
  const englishVectorBaseline = meanNdcg(baseline, "en", "vector", grades);
  const englishVectorCandidate = meanNdcg(candidate, "en", "vector", grades);
  const englishHybridBaseline = meanNdcg(baseline, "en", "hybrid", grades);
  const englishHybridCandidate = meanNdcg(candidate, "en", "hybrid", grades);
  const chineseHybridBaseline = meanNdcg(baseline, "zh-TW", "hybrid", grades);
  const chineseHybridCandidate = meanNdcg(candidate, "zh-TW", "hybrid", grades);
  const englishVectorDelta = englishVectorCandidate - englishVectorBaseline;
  const englishHybridDelta = englishHybridCandidate - englishHybridBaseline;
  const chineseHybridDelta = chineseHybridCandidate - chineseHybridBaseline;

  return {
    englishVectorBaseline,
    englishVectorCandidate,
    englishVectorDelta,
    englishHybridBaseline,
    englishHybridCandidate,
    englishHybridDelta,
    chineseHybridBaseline,
    chineseHybridCandidate,
    chineseHybridDelta,
    passed:
      englishVectorDelta >= 0.05 - 1e-12 &&
      englishHybridDelta >= -1e-12 &&
      chineseHybridDelta >= -0.01 - 1e-12,
  };
}

function reviewedGradeId(
  domain: "product-neighbour" | "related-brand" | "trail",
  anchor: string,
  candidate: string,
): string {
  return `${domain}:${anchor}:${candidate}`;
}

export function evaluateReviewedAnchors(
  baseline: CorpusSnapshot,
  candidate: CorpusSnapshot,
  overlap: Pick<
    ConsumerOverlap,
    "productAnchors" | "brandAnchors" | "changedTrails"
  >,
  grades: ReadonlyMap<string, number>,
) {
  const definitions = [
    ...overlap.productAnchors.map((anchor) => ({
      domain: "product-neighbour" as const,
      anchor,
      baseline: baseline.productNeighbours[anchor] ?? [],
      candidate: candidate.productNeighbours[anchor] ?? [],
    })),
    ...overlap.brandAnchors.map((anchor) => ({
      domain: "related-brand" as const,
      anchor,
      baseline: baseline.relatedBrands[anchor] ?? [],
      candidate: candidate.relatedBrands[anchor] ?? [],
    })),
    ...overlap.changedTrails.map((anchor) => ({
      domain: "trail" as const,
      anchor,
      baseline: baseline.trails[anchor] ?? [],
      candidate: candidate.trails[anchor] ?? [],
    })),
  ];

  return definitions.map((definition) => {
    const grade = (candidateId: string) => {
      const id = reviewedGradeId(
        definition.domain,
        definition.anchor,
        candidateId,
      );
      const value = grades.get(id);
      if (value === undefined) throw new Error(`Missing trusted grade: ${id}`);
      return value;
    };
    const baselineRelevance = definition.baseline.reduce(
      (sum, candidateId) => sum + grade(candidateId),
      0,
    );
    const candidateRelevance = definition.candidate.reduce(
      (sum, candidateId) => sum + grade(candidateId),
      0,
    );
    return {
      domain:
        definition.domain === "product-neighbour"
          ? ("product" as const)
          : definition.domain === "related-brand"
            ? ("brand" as const)
            : ("trail" as const),
      anchor: definition.anchor,
      baselineRelevance,
      candidateRelevance,
      passed: candidateRelevance >= baselineRelevance,
    };
  });
}
