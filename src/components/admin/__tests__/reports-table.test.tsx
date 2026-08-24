// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/en.json";
import type { BrandReport } from "@/lib/services/reports";
import { ReportsTable } from "../reports-table";

type ReviewAction = (
  id: string,
  decision: "reviewed" | "dismissed",
  notes?: string,
) => Promise<{ error?: string } | undefined>;

function report(
  overrides: Partial<BrandReport> & { id: string; brandName: string },
): BrandReport & { brandName: string } {
  const { id, brandName, ...rest } = overrides;
  return {
    id,
    brandId: "3f0a9d21-77c4-4e58-9b12-0d6e5c8a4471",
    brandName,
    brandSlug: "formoria-studio",
    reason: "incorrect_info",
    notes: "The listed product details need a review.",
    status: "pending",
    reviewedAt: null,
    createdAt: "2026-07-27T00:00:00.000Z",
    reporterEmail: "mei.lin@example.com",
    ...rest,
  };
}

function renderTable(
  reports: BrandReport[],
  actions: {
    reviewAction?: ReviewAction;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ReportsTable
        reports={reports}
        reviewAction={actions.reviewAction}
      />
    </NextIntlClientProvider>,
  );
}

function disclosureName(brandName: string): string {
  return messages.admin.queue.showDetails.replace("{name}", brandName);
}

describe("ReportsTable", () => {
  it("links the brand cell when the report still resolves a slug", () => {
    const item = report({
      id: "55c0a7e4-3d92-4f18-a6b7-2e91d47c5083",
      brandName: "Formoria Atelier",
      brandSlug: "formoria-atelier",
    });
    renderTable([item]);

    expect(
      screen.getByRole("link", { name: item.brandName }),
    ).toHaveAttribute("href", "/brands/formoria-atelier");
  });

  it("renders the brand name as plain text when the report has no slug", () => {
    const item = report({
      id: "66d1b8f5-4ea3-4029-b7c8-3f02e58d6194",
      brandName: "Formoria Foundry",
      brandSlug: null,
    });
    renderTable([item]);

    expect(screen.getByText(item.brandName)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: item.brandName })).toBeNull();
  });

  it("surfaces a decision failure to the operator", async () => {
    const user = userEvent.setup();
    const item = report({
      id: "11e4c6a0-2b95-4d17-8f3a-6c07b912de45",
      brandName: "Formoria Kiln",
    });
    const reviewAction = vi
      .fn<ReviewAction>()
      .mockResolvedValue({ error: "boom" });
    renderTable([item], { reviewAction });

    await user.click(
      screen.getByRole("button", { name: disclosureName(item.brandName) }),
    );
    await user.click(
      screen.getByRole("button", {
        name: messages.admin.reports.actions.markReviewed,
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        messages.admin.reports.errors.generic,
      );
    });
  });

  it("records reviewer attribution on a decision", async () => {
    const user = userEvent.setup();
    const item = report({
      id: "22a7f3d9-4c81-4be2-9d06-7e15a840cb32",
      brandName: "Formoria Loom",
    });
    const reviewAction = vi.fn<ReviewAction>().mockResolvedValue(undefined);
    renderTable([item], { reviewAction });

    await user.click(
      screen.getByRole("button", { name: disclosureName(item.brandName) }),
    );
    const notes = "The reviewer confirmed the reported issue.";
    await user.type(
      screen.getByRole("textbox", {
        name: messages.admin.reports.reviewerNotes,
      }),
      notes,
    );
    await user.click(
      screen.getByRole("button", {
        name: messages.admin.reports.actions.markReviewed,
      }),
    );

    await waitFor(() => {
      expect(reviewAction).toHaveBeenCalledWith(item.id, "reviewed", notes);
    });
  });
});
