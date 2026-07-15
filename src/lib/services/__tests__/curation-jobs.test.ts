import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CurationJob,
  CurationJobTarget,
} from "@/lib/services/curation-jobs";

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: mocks.createServiceClient,
}));

import {
  enqueueAdminCurationJob,
  enqueueAutomaticRetry,
  listCurationJobTargets,
} from "../curation-jobs";

describe("curation job target loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads every target page in deterministic order", async () => {
    const pages = [
      Array.from({ length: 1_000 }, (_, index) =>
        target(`target-${index}`, "pending"),
      ),
      [target("target-1000", "running")],
    ];
    const ranges: Array<[number, number]> = [];
    const targetQuery = pagedQuery(pages, ranges);
    mocks.from.mockReturnValue(targetQuery);
    mocks.createServiceClient.mockReturnValue({ from: mocks.from });

    const targets = await listCurationJobTargets("job-1");

    expect(targets).toHaveLength(1_001);
    expect(targets.at(-1)?.target_id).toBe("target-1000");
    expect(ranges).toEqual([
      [0, 999],
      [1_000, 1_999],
    ]);
    expect(targetQuery.order).toHaveBeenNthCalledWith(1, "created_at", {
      ascending: true,
    });
    expect(targetQuery.order).toHaveBeenNthCalledWith(2, "id", {
      ascending: true,
    });
  });
});

describe("admin curation target resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps a legacy provisional brand linked submission as a submission target", async () => {
    const submissionQuery = {
      select: vi.fn(() => ({
        in: vi.fn().mockResolvedValue({
          data: [
            {
              id: "submission-1",
              brand_id: "brand-1",
              brand_name: "小島誌",
              status: "pending",
            },
          ],
          error: null,
        }),
      })),
    };
    const jobQuery = singleQuery(job({ id: "job-1", status: "pending" }));
    mocks.from.mockImplementation((table: string) =>
      table === "brand_submissions" ? submissionQuery : jobQuery,
    );
    mocks.rpc.mockResolvedValue({ data: "job-1", error: null });
    mocks.createServiceClient.mockReturnValue({
      from: mocks.from,
      rpc: mocks.rpc,
    });

    await enqueueAdminCurationJob({
      params: { submissionIds: ["submission-1"] },
      dryRun: false,
      startedBy: "admin-1",
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "enqueue_curation_job",
      expect.objectContaining({
        p_targets: [
          {
            target_type: "submission",
            target_id: "submission-1",
            brand_name: "小島誌",
            brand_slug: null,
          },
        ],
      }),
    );
  });
});

describe("automatic curation retries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clones only unfinished targets", async () => {
    const targetPages = [
      [
        target("succeeded-target", "succeeded"),
        target("failed-target", "failed"),
        target("skipped-target", "skipped"),
        target("pending-target", "pending"),
        target("running-target", "running"),
      ],
    ];
    const targetQuery = pagedQuery(targetPages, []);
    const jobQuery = singleQuery(job({ id: "retry-job" }));
    mocks.from.mockImplementation((table: string) =>
      table === "curation_job_targets" ? targetQuery : jobQuery,
    );
    mocks.rpc.mockResolvedValue({ data: "retry-job", error: null });
    mocks.createServiceClient.mockReturnValue({
      from: mocks.from,
      rpc: mocks.rpc,
    });

    await enqueueAutomaticRetry(job());

    expect(mocks.rpc).toHaveBeenCalledWith(
      "enqueue_curation_job",
      expect.objectContaining({
        p_targets: [
          {
            target_type: "submission",
            target_id: "pending-target",
            brand_name: "品牌 pending-target",
            brand_slug: null,
          },
          {
            target_type: "submission",
            target_id: "running-target",
            brand_name: "品牌 running-target",
            brand_slug: null,
          },
        ],
      }),
    );
  });

  it("does not enqueue an empty retry for terminal targets", async () => {
    const targetQuery = pagedQuery(
      [
        [
          target("failed-target", "failed"),
          target("skipped-target", "skipped"),
        ],
      ],
      [],
    );
    mocks.from.mockReturnValue(targetQuery);
    mocks.createServiceClient.mockReturnValue({
      from: mocks.from,
      rpc: mocks.rpc,
    });

    await expect(enqueueAutomaticRetry(job())).resolves.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

type Query = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
};

function pagedQuery(
  pages: CurationJobTarget[][],
  ranges: Array<[number, number]>,
): Query {
  let page = 0;
  const query = {} as Query;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.neq = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.range = vi.fn(async (from: number, to: number) => {
    ranges.push([from, to]);
    return { data: pages[page++] ?? [], error: null };
  });
  query.single = vi.fn();
  return query;
}

function singleQuery(data: CurationJob): Query {
  const query = {} as Query;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.neq = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.range = vi.fn();
  query.single = vi.fn().mockResolvedValue({ data, error: null });
  return query;
}

function target(
  id: string,
  status: CurationJobTarget["status"],
): CurationJobTarget {
  return {
    id: `row-${id}`,
    job_id: "job-1",
    target_type: "submission",
    target_id: id,
    brand_name: `品牌 ${id}`,
    brand_slug: null,
    status,
    current_phase: null,
    phase_results: [],
    changed_fields: [],
    error: null,
    started_at: null,
    completed_at: null,
    duration_ms: null,
    created_at: "2026-07-13T16:00:00.000Z",
  };
}

function job(overrides: Partial<CurationJob> = {}): CurationJob {
  return {
    id: "job-1",
    operation: "enrich",
    status: "failed",
    trigger: "cron",
    attempt: 1,
    parent_job_id: null,
    params: { target: "submissions" },
    dry_run: false,
    progress: null,
    result: null,
    started_by: "railway-worker",
    created_at: "2026-07-13T16:00:00.000Z",
    started_at: null,
    completed_at: "2026-07-13T16:10:00.000Z",
    scheduled_for: null,
    run_after: "2026-07-13T16:10:00.000Z",
    dedupe_key: null,
    heartbeat_at: null,
    worker_token: null,
    job_error: "failed",
    current_target_id: null,
    current_phase: null,
    target_total: 5,
    succeeded_count: 1,
    skipped_count: 1,
    failed_count: 1,
    dispatch_status: "dispatched",
    dispatch_error: null,
    dispatched_at: null,
    ...overrides,
  };
}
