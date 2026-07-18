// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurationJob } from "@/lib/services/curation-jobs";

const { getAdminOperationsSnapshot } = vi.hoisted(() => ({
  getAdminOperationsSnapshot: vi.fn(),
}));

vi.mock("@/lib/services/admin-operations", () => ({
  getAdminOperationsSnapshot,
}));
vi.mock("@/app/admin/operations/actions", () => ({
  startNeedsDataSubmissionEnrichmentAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import AdminDashboardPage from "../page";

describe("Admin operations dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminOperationsSnapshot.mockResolvedValue({
      metrics: {
        needsData: 7,
        ready: 3,
        moderation: 2,
        claims: 4,
        reports: 5,
        activeJobs: 2,
        brands: 91,
        subscribers: 30,
      },
      recentJobs: [job()],
    });
  });

  it("puts the connected operations overview first and links every metric", async () => {
    render(await AdminDashboardPage());

    expect(screen.getByRole("heading", { name: "Operations overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Needs data 7/ })).toHaveAttribute(
      "href",
      "/admin/submissions?stage=needs_data",
    );
    expect(screen.getByRole("link", { name: /Subscribers 30/ })).toHaveAttribute(
      "href",
      "/admin/newsletter?status=active",
    );
    expect(screen.queryByRole("link", { name: /Brand edits/ })).not.toBeInTheDocument();
    expect(screen.queryByText("System Status")).not.toBeInTheDocument();
    expect(screen.queryByText("Feature Toggles")).not.toBeInTheDocument();
  });

  it("renders unavailable metrics honestly and disables dependent work", async () => {
    getAdminOperationsSnapshot.mockResolvedValueOnce({
      metrics: {
        needsData: null,
        ready: null,
        moderation: 0,
        claims: 0,
        reports: 0,
        activeJobs: 0,
        brands: 0,
        subscribers: 0,
      },
      recentJobs: [],
    });

    render(await AdminDashboardPage());

    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Enrich needs-data submissions" })).toBeDisabled();
  });

  it("shows the quick operation and only the newest job summary", async () => {
    render(await AdminDashboardPage());

    expect(screen.getByRole("button", { name: "Enrich needs-data submissions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /2026/ })).toHaveAttribute(
      "href",
      "/admin/jobs/550e8400-e29b-41d4-a716-446655440000",
    );
    expect(screen.getByRole("link", { name: "View all jobs" })).toHaveAttribute("href", "/admin/jobs");
  });
});

function job(): CurationJob {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    operation: "enrich",
    status: "running",
    trigger: "admin",
    attempt: 1,
    parent_job_id: null,
    params: null,
    dry_run: false,
    progress: null,
    result: null,
    started_by: "admin@example.com",
    created_at: "2026-07-13T16:00:00.000Z",
    started_at: "2026-07-13T16:00:01.000Z",
    completed_at: null,
    scheduled_for: null,
    run_after: "2026-07-13T16:00:00.000Z",
    dedupe_key: null,
    heartbeat_at: "2026-07-13T16:00:11.000Z",
    worker_token: null,
    job_error: null,
    current_target_id: null,
    current_phase: "persist",
    target_total: 7,
    succeeded_count: 2,
    skipped_count: 0,
    failed_count: 0,
    cancelled_count: 0,
    dispatch_status: "dispatched",
    dispatch_error: null,
    dispatched_at: "2026-07-13T16:00:01.000Z",
  };
}
