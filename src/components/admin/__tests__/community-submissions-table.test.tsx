// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  loadCsv: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("@/app/admin/scripts/bulk-community-submissions/actions", () => ({
  loadCommunitySubmissionsCsvAction: actions.loadCsv,
  previewCommunitySubmissionsAction: actions.preview,
  executeCommunitySubmissionsAction: actions.execute,
}));

import { CommunitySubmissionsTable } from "../community-submissions-table";

describe("CommunitySubmissionsTable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("automatically previews a CSV and selects ready rows", async () => {
    const user = userEvent.setup();
    actions.loadCsv.mockResolvedValue({
      rows: [{ id: "csv-1", name: "CSV Brand", website: "https://csv.test" }],
    });
    actions.preview.mockResolvedValue({
      rows: [
        {
          id: "csv-1",
          name: "CSV Brand",
          website: "https://csv.test",
          normalizedName: "CSV Brand",
          normalizedWebsite: "https://csv.test",
          status: "ready",
          similarBrands: [],
        },
      ],
    });
    render(<CommunitySubmissionsTable />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add row" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Preview rows" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Not previewed")).not.toBeInTheDocument();

    await uploadCsv(user);

    expect(await screen.findByDisplayValue("CSV Brand")).toBeInTheDocument();
    expect(actions.preview).toHaveBeenCalledWith([
      { id: "csv-1", name: "CSV Brand", website: "https://csv.test" },
    ]);
    expect(screen.getByLabelText("Select CSV Brand")).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Import 1 selected" }),
    ).toBeEnabled();
    expect(screen.queryByText("Not previewed")).not.toBeInTheDocument();
  });

  it("selects ready rows by default while requiring a similar-match override", async () => {
    const user = userEvent.setup();
    actions.loadCsv.mockResolvedValue({
      rows: [
        { id: "ready", name: "Ready", website: "ready.test" },
        { id: "similar", name: "Similar", website: "similar.test" },
        { id: "duplicate", name: "Duplicate", website: "duplicate.test" },
        { id: "invalid", name: "Invalid", website: "" },
      ],
    });
    actions.preview.mockImplementation(
      async (drafts: Array<{ id: string; name: string; website: string }>) => ({
        rows: [
          {
            ...drafts[0],
            normalizedName: "Ready",
            normalizedWebsite: "https://ready.test",
            status: "ready",
            similarBrands: [],
          },
          {
            ...drafts[1],
            normalizedName: "Similar",
            normalizedWebsite: "https://similar.test",
            status: "similar",
            message: "Similar to Existing",
            similarBrands: [{ name: "Existing", slug: "existing", score: 0.8 }],
          },
          {
            ...drafts[2],
            normalizedName: "Duplicate",
            normalizedWebsite: "https://duplicate.test",
            status: "duplicate",
            message: "Exact duplicate already exists",
            similarBrands: [],
          },
          {
            ...drafts[3],
            normalizedName: null,
            normalizedWebsite: null,
            status: "invalid",
            message: "Official website is required",
            similarBrands: [],
          },
        ],
      }),
    );
    render(<CommunitySubmissionsTable />);
    await uploadCsv(user);

    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Similar")).toBeInTheDocument();
    expect(screen.getByText("Exact duplicate")).toBeInTheDocument();
    expect(screen.getByText("Invalid")).toBeInTheDocument();
    expect(screen.getByLabelText("Select Ready")).toBeChecked();
    expect(screen.getByLabelText("Select Similar")).not.toBeChecked();
    expect(screen.getByLabelText("Select Duplicate")).toBeDisabled();
    expect(screen.getByLabelText("Select Invalid")).toBeDisabled();
    await user.click(screen.getByLabelText("Select Similar"));
    expect(screen.getByLabelText("Select Similar")).toBeChecked();
  });

  it("keeps failures retryable and replaces their result after a successful retry", async () => {
    const user = userEvent.setup();
    actions.preview.mockImplementation(
      async (drafts: Array<{ id: string; name: string; website: string }>) => ({
        rows: drafts.map((row) => ({
          ...row,
          normalizedName: row.name,
          normalizedWebsite: "https://retry.test",
          status: "ready",
          similarBrands: [],
        })),
      }),
    );
    actions.loadCsv.mockResolvedValue({
      rows: [{ id: "retry", name: "Retry Brand", website: "retry.test" }],
    });
    actions.execute
      .mockImplementationOnce(async (drafts: Array<{ id: string }>) => ({
        results: [
          {
            id: drafts[0].id,
            status: "failed",
            message: "Database unavailable",
          },
        ],
      }))
      .mockImplementationOnce(async (drafts: Array<{ id: string }>) => ({
        results: [
          { id: drafts[0].id, status: "created", submissionId: "submission-1" },
        ],
      }));
    render(<CommunitySubmissionsTable />);
    await uploadCsv(user);
    await user.click(
      await screen.findByRole("button", { name: "Import 1 selected" }),
    );

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Database unavailable")).toBeInTheDocument();
    expect(screen.getByLabelText("Select Retry Brand")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Retry 1 selected" }));

    await waitFor(() => expect(screen.getByText("Done")).toBeInTheDocument());
    expect(screen.getByText("Done")).toHaveClass(
      "bg-verified-green-bg",
      "text-verified-green",
    );
    expect(screen.queryByText("Database unavailable")).not.toBeInTheDocument();
  });
});

async function uploadCsv(user: ReturnType<typeof userEvent.setup>) {
  const file = new File(["name,website\nCSV Brand,csv.test"], "brands.csv", {
    type: "text/csv",
  });
  Object.defineProperty(file, "text", {
    value: vi.fn().mockResolvedValue("name,website\nCSV Brand,csv.test"),
  });
  await user.upload(screen.getByLabelText("Upload CSV"), file);
}
