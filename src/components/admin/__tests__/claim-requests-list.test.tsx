// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/en.json";
import type { ClaimRequest } from "@/lib/services/claim-requests";
import { ClaimRequestsList } from "../claim-requests-list";

type ClaimActionResult = Promise<
  { error?: string; warning?: string } | undefined
>;

type ApproveAction = (id: string) => ClaimActionResult;
type RejectAction = (id: string, notes: string) => ClaimActionResult;

function claim(
  overrides: Partial<ClaimRequest> & { id: string; brandName: string },
): ClaimRequest & { brandName: string } {
  const { id, brandName, ...rest } = overrides;
  return {
    id,
    brandId: "3f0a9d21-77c4-4e58-9b12-0d6e5c8a4471",
    userId: "9c1f4b2e-6d38-4a71-8c05-2f7b9e1d4a63",
    proofType: "business_doc",
    proofUrl: null,
    proofNotes: null,
    proofEvidence: [],
    mitSmileCert: null,
    mitRegistryCompanyName: null,
    status: "pending",
    reviewerNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: "2026-07-27T00:00:00.000Z",
    brandName,
    brandSlug: "formoria-studio",
    requesterEmail: "mei.lin@example.com",
    proofCleanupStatus: null,
    existingOwnedBrand: null,
    ...rest,
  };
}

function renderList(
  claimRequests: ClaimRequest[],
  actions: {
    approveAction?: ApproveAction;
    rejectAction?: RejectAction;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ClaimRequestsList
        claimRequests={claimRequests}
        approveAction={actions.approveAction}
        rejectAction={actions.rejectAction}
      />
    </NextIntlClientProvider>,
  );
}

function disclosureName(brandName: string): string {
  return messages.admin.queue.showDetails.replace("{name}", brandName);
}

describe("ClaimRequestsList", () => {
  it("two-step reject requires a preset reason before submitting", async () => {
    const user = userEvent.setup();
    const item = claim({
      id: "11e4c6a0-2b95-4d17-8f3a-6c07b912de45",
      brandName: "Formoria Claim Review",
    });
    const rejectAction = vi.fn<RejectAction>().mockResolvedValue(undefined);
    renderList([item], { rejectAction });

    await user.click(
      screen.getByRole("button", { name: disclosureName(item.brandName) }),
    );
    await user.click(
      screen.getByRole("button", {
        name: messages.admin.claimRequests.actions.reject,
      }),
    );

    expect(rejectAction).not.toHaveBeenCalled();
    expect(
      screen.getByRole("combobox", {
        name: messages.admin.claimRequests.rejectReasons.label,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", {
        name: messages.admin.claimRequests.rejectNotesLabel,
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: messages.admin.claimRequests.actions.confirmReject,
      }),
    );
    expect(rejectAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      messages.admin.claimRequests.errors.rejectNotesRequired,
    );
    await user.selectOptions(
      screen.getByRole("combobox", {
        name: messages.admin.claimRequests.rejectReasons.label,
      }),
      "insufficientProof",
    );
    await user.click(
      screen.getByRole("button", {
        name: messages.admin.claimRequests.actions.confirmReject,
      }),
    );

    await waitFor(() => {
      expect(rejectAction).toHaveBeenCalledWith(
        item.id,
        messages.admin.claimRequests.rejectReasons.insufficientProof,
      );
    });
  });

  it("disables approve when the requester already owns a brand", async () => {
    const user = userEvent.setup();
    const item = claim({
      id: "22a7f3d9-4c81-4be2-9d06-7e15a840cb32",
      brandName: "Formoria Existing Owner Review",
      existingOwnedBrand: {
        brandId: "33b8e5c2-1f60-4a93-b48d-9c02f6e71da5",
        brandName: "Formoria Existing Brand",
        brandSlug: "formoria-existing-brand",
      },
    });
    renderList([item]);

    await user.click(
      screen.getByRole("button", { name: disclosureName(item.brandName) }),
    );

    expect(
      screen.getByRole("button", {
        name: messages.admin.claimRequests.actions.approve,
      }),
    ).toBeDisabled();
    const existingBrand = item.existingOwnedBrand;
    if (!existingBrand) throw new Error("Expected an existing owned brand");
    expect(
      screen.getByText(messages.admin.claimRequests.ownerAlreadyManagesTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        messages.admin.claimRequests.ownerAlreadyManagesBody.replace(
          "{brandName}",
          existingBrand.brandName,
        ),
      ),
    ).toBeInTheDocument();
  });
});
