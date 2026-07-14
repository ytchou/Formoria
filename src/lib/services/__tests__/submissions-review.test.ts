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
    const rows = Array.from({ length: 1_001 }, (_, index) =>
      submission(`submission-${index}`),
    );
    const historyPages = [
      Array.from({ length: 1_000 }, (_, index) =>
        target(`submission-${index}`, "succeeded"),
      ),
      [target("submission-1000", "running")],
    ];
    const ranges: Array<[number, number]> = [];
    const submissionQuery = {
      select: vi.fn(() => submissionQuery),
      order: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    const historyQuery = pagedQuery(historyPages, ranges);
    mocks.from.mockImplementation((table: string) =>
      table === "brand_submissions" ? submissionQuery : historyQuery,
    );

    const result = await getSubmissionsForReview();
    const olderSubmission = result.find(
      (item) => item.id === "submission-1000",
    );

    expect(olderSubmission).toMatchObject({
      latestCurationTargetStatus: "running",
      latestCurationJobId: "job-submission-1000",
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
});

type Query = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
};

function pagedQuery(
  pages: Array<Array<Record<string, unknown>>>,
  ranges: Array<[number, number]>,
): Query {
  let page = 0;
  const query = {} as Query;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.range = vi.fn(async (from: number, to: number) => {
    ranges.push([from, to]);
    return { data: pages[page++] ?? [], error: null };
  });
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
