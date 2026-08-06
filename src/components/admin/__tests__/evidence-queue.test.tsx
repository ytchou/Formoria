// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/en.json";
import type {
  EvidenceBatchFailure,
  OriginEvidence,
  OriginEvidenceDecision,
} from "@/lib/services/origin-evidence";
import { EvidenceQueue } from "../evidence-queue";

type ReviewAction = (
  id: string,
  decision: OriginEvidenceDecision,
  notes: string,
  tierAction?: "strip_declaration",
) => Promise<{ error?: string } | undefined>;

type BulkReviewAction = (
  ids: string[],
  decision: OriginEvidenceDecision,
  notes: string,
) => Promise<{ failures: EvidenceBatchFailure[] } | { error: string }>;

function evidence(
  overrides: Partial<OriginEvidence> & { id: string; brandName: string },
): OriginEvidence & { brandName: string } {
  const { id, brandName, ...rest } = overrides;
  return {
    id,
    brandId: "3f0a9d21-77c4-4e58-9b12-0d6e5c8a4471",
    userId: "9c1f4b2e-6d38-4a71-8c05-2f7b9e1d4a63",
    stance: "supports",
    productName: "Formoria tea set",
    sourceType: "product_label",
    notes: "The product label identifies Taiwan as the manufacturing origin.",
    photos: [],
    status: "pending",
    reviewedAt: null,
    reviewedBy: null,
    reviewerNotes: null,
    createdAt: "2026-07-27T00:00:00.000Z",
    brandName,
    brandSlug: "formoria-studio",
    brandMitStatus: "verified",
    ...rest,
  };
}

function renderQueue(
  rows: OriginEvidence[],
  actions: {
    reviewAction?: ReviewAction;
    bulkReviewAction?: BulkReviewAction;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <EvidenceQueue
        evidence={rows}
        reviewAction={actions.reviewAction}
        bulkReviewAction={actions.bulkReviewAction}
      />
    </NextIntlClientProvider>,
  );
}

function disclosureName(brandName: string, expanded = false): string {
  const template = expanded
    ? messages.admin.queue.hideDetails
    : messages.admin.queue.showDetails;
  return template.replace("{name}", brandName);
}

describe("EvidenceQueue", () => {
  it("requires notes to reject", async () => {
    const user = userEvent.setup();
    const item = evidence({
      id: "11e4c6a0-2b95-4d17-8f3a-6c07b912de45",
      brandName: "Formoria Kiln",
    });
    const reviewAction = vi.fn<ReviewAction>().mockResolvedValue(undefined);
    renderQueue([item], { reviewAction });

    await user.click(
      screen.getByRole("button", { name: disclosureName(item.brandName) }),
    );

    const rejectButton = screen.getByRole("button", {
      name: messages.admin.evidence.actions.reject,
    });
    const notes = screen.getByRole("textbox", {
      name: messages.admin.evidence.fields.reviewerNotes,
    });
    expect(rejectButton).toBeDisabled();
    expect(notes).toHaveAttribute("aria-required", "true");
    expect(reviewAction).not.toHaveBeenCalled();

    const reviewerNotes = "The evidence does not support the stated origin.";
    await user.type(notes, reviewerNotes);
    expect(rejectButton).toBeEnabled();
    await user.click(rejectButton);

    await waitFor(() => {
      expect(reviewAction).toHaveBeenCalledWith(
        item.id,
        "rejected",
        reviewerNotes,
        undefined,
      );
    });
  });

  it("shows the strip-declaration toggle only for a contradicting declared brand", async () => {
    const user = userEvent.setup();
    const contradicting = evidence({
      id: "22a7f3d9-4c81-4be2-9d06-7e15a840cb32",
      brandName: "Formoria Declaration Review",
      stance: "contradicts",
      brandMitStatus: "declared",
    });
    const supporting = evidence({
      id: "33b8e5c2-1f60-4a93-b48d-9c02f6e71da5",
      brandName: "Formoria Verified Review",
      stance: "supports",
      brandMitStatus: "verified",
    });
    renderQueue([contradicting, supporting]);

    await user.click(
      screen.getByRole("button", {
        name: disclosureName(contradicting.brandName),
      }),
    );
    expect(
      screen.getByRole("checkbox", {
        name: messages.admin.evidence.stripDeclaration,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    await user.click(
      screen.getByRole("button", {
        name: disclosureName(supporting.brandName),
      }),
    );
    expect(
      screen.queryByRole("checkbox", {
        name: messages.admin.evidence.stripDeclaration,
      }),
    ).toBeNull();
  });

  it("filters rows by status tab", async () => {
    const user = userEvent.setup();
    const pending = evidence({
      id: "44d1a7b6-3e29-4c05-8a71-b6f3c9e2408d",
      brandName: "Formoria Pending Review",
      status: "pending",
    });
    const approved = evidence({
      id: "55e2b8c7-4f30-5d16-9b82-c7f4d0a3519e",
      brandName: "Formoria Approved Review",
      status: "approved",
      reviewedAt: "2026-07-28T00:00:00.000Z",
      reviewedBy: "9c1f4b2e-6d38-4a71-8c05-2f7b9e1d4a63",
    });
    const rejected = evidence({
      id: "66f3c9d8-5a41-6e27-ac93-d8f5e1b462a0",
      brandName: "Formoria Rejected Review",
      status: "rejected",
      reviewedAt: "2026-07-29T00:00:00.000Z",
      reviewedBy: "9c1f4b2e-6d38-4a71-8c05-2f7b9e1d4a63",
    });
    renderQueue([pending, approved, rejected]);

    expect(screen.getByRole("tab", { name: "All (3)" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Pending (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Approved (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Rejected (1)" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Approved (1)" }));
    expect(
      screen.getByRole("row", { name: new RegExp(approved.brandName) }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("row", { name: new RegExp(pending.brandName) }),
    ).toBeNull();
    expect(
      screen.queryByRole("row", { name: new RegExp(rejected.brandName) }),
    ).toBeNull();
  });

  it("bulk approve passes only selected ids once", async () => {
    const user = userEvent.setup();
    const selected = evidence({
      id: "77a4d0e9-6b52-7f38-bda4-e906f2c573b1",
      brandName: "Formoria Selected Review",
    });
    const unselected = evidence({
      id: "88b5e1fa-7c63-8049-ceb5-f017g3d684c2",
      brandName: "Formoria Unselected Review",
    });
    const secondSelected = evidence({
      id: "99c6f2ab-8d74-915a-dfc6-a128h4e795d3",
      brandName: "Formoria Second Selected Review",
    });
    const bulkReviewAction = vi
      .fn<BulkReviewAction>()
      .mockResolvedValue({ failures: [] });
    renderQueue([selected, unselected, secondSelected], { bulkReviewAction });

    await user.click(
      screen.getByRole("checkbox", { name: `Select ${selected.brandName}` }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: `Select ${secondSelected.brandName}`,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: messages.admin.evidence.bulkApprove.replace("{count}", "2"),
      }),
    );

    await waitFor(() => {
      expect(bulkReviewAction).toHaveBeenCalledTimes(1);
      expect(bulkReviewAction).toHaveBeenCalledWith(
        [selected.id, secondSelected.id],
        "approved",
        "",
      );
    });
  });
});
