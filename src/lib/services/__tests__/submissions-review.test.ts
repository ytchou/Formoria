import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ from: mocks.from }),
}));

import { getSubmissionsForReview } from "../submissions";

describe("submission review curation history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pages target history so older submissions retain their latest state", async () => {
    const rows = [submission("submission-1")];
    const historyPages = [
      [
        target("submission-1", "running"),
        ...Array.from({ length: 999 }, () =>
          target("submission-1", "succeeded"),
        ),
      ],
      [target("submission-1", "succeeded")],
    ];
    const ranges: Array<[number, number]> = [];
    const submissionQuery = pagedSubmissionQuery([rows], rows.length, []);
    const historyQuery = pagedQuery(historyPages, ranges);
    const jobsQuery = listQuery(
      rows.map((row) => ({
        id: `job-${row.id}`,
        status: "running",
        dispatch_status: "dispatched",
        dispatch_error: null,
        job_error: null,
      })),
    );
    const imagesQuery = imageListQuery([]);
    const candidatesQuery = candidateListQuery([]);
    mocks.from.mockImplementation((table: string) => {
      if (table === "brand_submissions") return submissionQuery;
      if (table === "curation_job_targets") return historyQuery;
      if (table === "curation_jobs") return jobsQuery;
      if (table === "submission_images") return imagesQuery;
      if (table === "brand_location_candidates") return candidatesQuery;
      return imagesQuery;
    });

    const result = await getSubmissionsForReview();
    const olderSubmission = result.find(
      (item) => item.id === "submission-1",
    );

    expect(olderSubmission).toMatchObject({
      latestCurationTargetStatus: "running",
      latestCurationJobId: "job-submission-1",
      reviewStage: "enriching",
    });
    expect(ranges).toEqual([
      [0, 999],
      [1_000, 1_999],
    ]);
    expect(historyQuery.order).toHaveBeenNthCalledWith(1, "created_at", {
      ascending: false,
    });
    expect(historyQuery.order).toHaveBeenNthCalledWith(2, "id", {
      ascending: false,
    });
  });

  it("chunks large submission filters before querying PostgREST", async () => {
    const rows = Array.from({ length: 201 }, (_, index) =>
      submission(`submission-${index}`),
    );
    const targetIdChunks: string[][] = [];
    const candidateIdChunks: string[][] = [];
    const submissionQuery = pagedSubmissionQuery([rows], rows.length, []);
    const historyQuery = pagedQuery([[], []], [], targetIdChunks);
    const imagesQuery = imageListQuery([]);
    const candidatesQuery = candidateListQuery([], candidateIdChunks);
    mocks.from.mockImplementation((table: string) => {
      if (table === "brand_submissions") return submissionQuery;
      if (table === "curation_job_targets") return historyQuery;
      if (table === "submission_images") return imagesQuery;
      if (table === "brand_location_candidates") return candidatesQuery;
      return imagesQuery;
    });

    await getSubmissionsForReview();

    expect(targetIdChunks).toHaveLength(2);
    expect(targetIdChunks.every((ids) => ids.length <= 200)).toBe(true);
    expect(candidateIdChunks).toHaveLength(2);
    expect(candidateIdChunks.every((ids) => ids.length <= 200)).toBe(true);
  });

  it("loads every review submission page past the PostgREST row limit", async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) =>
      submission(`submission-${index}`),
    );
    const secondPage = [submission("submission-1000")];
    const submissionRanges: Array<[number, number]> = [];
    const submissionQuery = pagedSubmissionQuery(
      [firstPage, secondPage],
      1_001,
      submissionRanges,
    );
    const historyQuery = pagedQuery(
      Array.from({ length: 6 }, () => []),
      [],
    );
    const imagesQuery = imageListQuery([]);
    const candidatesQuery = candidateListQuery([]);
    mocks.from.mockImplementation((table: string) => {
      if (table === "brand_submissions") return submissionQuery;
      if (table === "curation_job_targets") return historyQuery;
      if (table === "submission_images") return imagesQuery;
      if (table === "brand_location_candidates") return candidatesQuery;
      return imagesQuery;
    });

    const result = await getSubmissionsForReview({ status: "pending" });

    expect(result).toHaveLength(1_001);
    expect(submissionRanges).toEqual([
      [0, 999],
      [1_000, 1_999],
    ]);
  });

  it("batch-loads staged images and exposes the same normalized persisted review", async () => {
    const rows = [
      {
        ...submission("submission-1"),
        enriched_data: {
          description: "豐富後介紹",
          product_type: "crafts",
          product_tags: ["木工"],
          price_range: 2,
          purchase_website: "https://brand.example.com",
        },
      },
    ];
    const submissionQuery = pagedSubmissionQuery([rows], rows.length, []);
    const historyQuery = pagedQuery(
      [[target("submission-1", "succeeded")]],
      [],
    );
    const jobsQuery = listQuery([
      {
        id: "job-submission-1",
        status: "succeeded",
        dispatch_status: "dispatched",
        dispatch_error: null,
        job_error: null,
      },
    ]);
    const imageIds: string[][] = [];
    const imagesQuery = imageListQuery(
      [
        submissionImage("hero", "https://cdn.example.com/hero.webp", 0),
        submissionImage("detail", "https://cdn.example.com/detail.webp", 1),
      ],
      imageIds,
    );
    const candidatesQuery = candidateListQuery([]);
    mocks.from.mockImplementation((table: string) => {
      if (table === "brand_submissions") return submissionQuery;
      if (table === "curation_job_targets") return historyQuery;
      if (table === "curation_jobs") return jobsQuery;
      if (table === "submission_images") return imagesQuery;
      if (table === "brand_location_candidates") return candidatesQuery;
      return imagesQuery;
    });

    const [result] = await getSubmissionsForReview();

    expect(imageIds).toEqual([["submission-1"]]);
    expect(result).toMatchObject({
      reviewData: {
        description: "豐富後介紹",
        productType: "crafts",
        productTags: ["木工"],
        priceRange: 2,
        websiteUrl: "https://brand.example.com",
        heroImageUrl: "https://cdn.example.com/hero.webp",
      },
      reviewCompleteness: { complete: true, missingFields: [] },
      reviewStage: "ready",
    });
    expect(result?.reviewImages.map((image) => image.id)).toEqual([
      "hero",
      "detail",
    ]);
  });
});

type Query = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
};

function pagedSubmissionQuery(
  pages: Array<Array<Record<string, unknown>>>,
  count: number,
  ranges: Array<[number, number]>,
) {
  let page = 0;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(async (from: number, to: number) => {
      ranges.push([from, to]);
      return { data: pages[page++] ?? [], count, error: null };
    }),
  };
  return query;
}

function pagedQuery(
  pages: Array<Array<Record<string, unknown>>>,
  ranges: Array<[number, number]>,
  targetIdChunks: string[][] = [],
): Query {
  let page = 0;
  const query = {} as Query;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn((_column: string, ids: string[]) => {
    targetIdChunks.push(ids);
    return query;
  });
  query.order = vi.fn(() => query);
  query.range = vi.fn(async (from: number, to: number) => {
    ranges.push([from, to]);
    return { data: pages[page++] ?? [], error: null };
  });
  return query;
}

function listQuery(rows: Array<Record<string, unknown>>) {
  const query = {
    select: vi.fn(() => query),
    in: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  return query;
}

function imageListQuery(
  rows: Array<Record<string, unknown>>,
  ids: string[][] = [],
) {
  const query = {
    select: vi.fn(() => query),
    in: vi.fn((_column: string, values: string[]) => {
      ids.push(values);
      return query;
    }),
    order: vi.fn((column: string) =>
      column === "sort_order"
        ? query
        : Promise.resolve({ data: rows, error: null }),
    ),
  };
  return query;
}

function candidateListQuery(
  rows: Array<Record<string, unknown>>,
  submissionIdChunks: string[][] = [],
) {
  const query = {
    select: vi.fn(() => query),
    in: vi.fn((_column: string, values: string[]) => {
      submissionIdChunks.push(values);
      return query;
    }),
    order: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  return query;
}

function submission(id: string): Record<string, unknown> {
  return {
    id,
    brand_id: null,
    brand_name: `品牌 ${id}`,
    submitter_email: `${id}@example.com`,
    submitter_name: null,
    description: "A submission description",
    website_url: "https://example.com",
    hero_image_url: null,
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    purchase_website: null,
    purchase_pinkoi: null,
    purchase_shopee: null,
    other_urls: [],
    suggested_tags: [],
    status: "pending",
    reviewer_notes: null,
    submitted_at: "2026-07-13T16:00:00.000Z",
    reviewed_at: null,
    reviewed_by: null,
    pdpa_consent_at: null,
    validation_status: null,
    validation_errors: null,
    notified_at: null,
    is_brand_owner: false,
    intent: "recommend",
    source_attribution: null,
    product_type_note: null,
    enriched_data: null,
  };
}

function target(
  targetId: string,
  status: "pending" | "running" | "succeeded" | "skipped" | "failed",
): Record<string, unknown> {
  return {
    id: `target-${targetId}`,
    target_id: targetId,
    job_id: `job-${targetId}`,
    status,
    current_phase: status === "running" ? "links" : null,
    error: null,
    created_at: "2026-07-13T16:00:00.000Z",
  };
}

function submissionImage(id: string, url: string, sortOrder: number) {
  return {
    id,
    submission_id: "submission-1",
    storage_path: `submissions/submission-1/${id}.webp`,
    url,
    source: "admin",
    status: "active",
    tags: null,
    score: null,
    alt_zh: null,
    alt_en: null,
    width: 1200,
    height: 900,
    dominant_color: null,
    sort_order: sortOrder,
    source_url: null,
    phash: null,
    created_at: "2026-07-13T16:00:00.000Z",
  };
}
