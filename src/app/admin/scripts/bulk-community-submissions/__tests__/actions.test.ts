import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  parseCsv: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn(),
  submit: vi.fn(),
  buildGuestEmail: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-admin", () => ({
  requireAdminAction: mocks.requireAdminAction,
}));
vi.mock("@/lib/services/community-submissions", () => ({
  MAX_COMMUNITY_SUBMISSIONS: 100,
  parseCommunitySubmissionsCsv: mocks.parseCsv,
  previewCommunitySubmissions: mocks.preview,
  executeCommunitySubmissions: mocks.execute,
}));
vi.mock("@/lib/adapters/community-submissions-repository", () => ({
  communitySubmissionsRepository: { loadExistingRecords: vi.fn() },
}));
vi.mock("@/lib/services/submission-pipeline", () => ({
  submitBrandForReview: mocks.submit,
}));
vi.mock("@/lib/services/submissions", () => ({
  buildGuestSubmissionEmail: mocks.buildGuestEmail,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  executeCommunitySubmissionsAction,
  loadCommunitySubmissionsCsvAction,
  previewCommunitySubmissionsAction,
} from "../actions";

const drafts = [{ id: "row-1", name: "Alpha", website: "alpha.test" }];

describe("community submission actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminAction.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com" },
    });
  });

  it("protects CSV loading, preview, and execution before service work", async () => {
    mocks.requireAdminAction.mockResolvedValue({
      error: "Forbidden",
      code: "forbidden",
    });

    await expect(
      loadCommunitySubmissionsCsvAction("name,website"),
    ).resolves.toEqual({
      error: "Forbidden",
    });
    await expect(previewCommunitySubmissionsAction(drafts)).resolves.toEqual({
      error: "Forbidden",
    });
    await expect(executeCommunitySubmissionsAction(drafts)).resolves.toEqual({
      error: "Forbidden",
    });
    expect(mocks.parseCsv).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("loads strict CSV through the service", async () => {
    mocks.parseCsv.mockReturnValue(drafts);

    await expect(
      loadCommunitySubmissionsCsvAction("name,website\nAlpha,alpha.test"),
    ).resolves.toEqual({ rows: drafts });
  });

  it("validates preview drafts at the action boundary", async () => {
    await expect(
      previewCommunitySubmissionsAction([
        { id: "", name: "A", website: "a.test" },
      ]),
    ).resolves.toEqual({
      error: "Invalid community submission rows",
    });
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("routes preview and execution through independent service calls", async () => {
    mocks.preview.mockResolvedValue([{ ...drafts[0], status: "ready" }]);
    mocks.execute.mockResolvedValue([
      { id: "row-1", status: "created", submissionId: "submission-1" },
    ]);

    await expect(previewCommunitySubmissionsAction(drafts)).resolves.toEqual({
      rows: expect.any(Array),
    });
    await expect(executeCommunitySubmissionsAction(drafts)).resolves.toEqual({
      results: expect.any(Array),
    });

    expect(mocks.execute).toHaveBeenCalledWith(
      drafts,
      expect.objectContaining({
        repository: expect.any(Object),
        submit: expect.any(Function),
        buildGuestEmail: mocks.buildGuestEmail,
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/submissions");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("does not revalidate submission caches when nothing was created", async () => {
    mocks.execute.mockResolvedValue([
      { id: "row-1", status: "failed", message: "Database error" },
    ]);

    await executeCommunitySubmissionsAction(drafts);

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
