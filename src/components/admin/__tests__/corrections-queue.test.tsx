// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/en.json";
import { MAX_PRODUCT_TAGS } from "@/lib/services/product-tags";
import type {
  CorrectionBatchFailure,
  CorrectionDecision,
} from "@/lib/services/brand-corrections";
import {
  CorrectionsQueue,
  type CorrectionQueueItem,
} from "../corrections-queue";

const NOVEL_TAG = "手工皂磨具";
const CANONICAL_TAG = "洋裝";
const REMOVED_TAG = "冷製皂";
const NOVEL_MARKER = messages.admin.corrections.novelTag;
const NOT_AVAILABLE = messages.admin.corrections.notAvailable;
const INSTAGRAM_URL = "https://instagram.com/formoria";
const WEBSITE_URL = "https://formoria.example.com";
const CAP_TAGS = ["洋裝", "後背包", "耳環", "手工皂", "茶葉"];

const TAG_CORRECTION: CorrectionQueueItem = {
  id: "correction-tags",
  brandName: "Formoria Studio",
  field: "product_tags",
  currentValue: [REMOVED_TAG],
  proposedValue: {
    add: [NOVEL_TAG, CANONICAL_TAG],
    remove: [REMOVED_TAG],
  },
  stale: false,
  createdAt: "2026-07-27T00:00:00.000Z",
};

type BulkReviewAction = (
  ids: string[],
  decision: CorrectionDecision,
  notes: string,
) => Promise<{ failures: CorrectionBatchFailure[] } | { error: string }>;

function correction(
  overrides: Partial<CorrectionQueueItem> &
    Pick<CorrectionQueueItem, "id" | "field" | "proposedValue">,
): CorrectionQueueItem {
  return {
    brandName: "Formoria Studio",
    currentValue: null,
    stale: false,
    createdAt: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

function renderQueue(
  corrections: CorrectionQueueItem[] = [TAG_CORRECTION],
  actions: {
    reviewAction?: (
      id: string,
      decision: CorrectionDecision,
      notes: string,
    ) => Promise<{ error?: string } | undefined>;
    bulkReviewAction?: BulkReviewAction;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CorrectionsQueue
        corrections={corrections}
        reviewAction={actions.reviewAction}
        bulkReviewAction={actions.bulkReviewAction}
      />
    </NextIntlClientProvider>,
  );
}

function rowFor(brandName: string): HTMLElement {
  return screen.getByRole("row", { name: new RegExp(brandName) });
}

function disclosureName(brandName: string, expanded = false): string {
  const template = expanded
    ? messages.admin.queue.hideDetails
    : messages.admin.queue.showDetails;
  return template.replace("{name}", brandName);
}

describe("CorrectionsQueue", () => {
  it("renders the proposed value for a tag-delta correction", () => {
    renderQueue();

    expect(
      within(
        screen.getByRole("cell", {
          name: new RegExp(`\\+${NOVEL_TAG}`),
        }),
      ).getByText(`+${NOVEL_TAG}`),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("cell", {
          name: new RegExp(`\\+${CANONICAL_TAG}`),
        }),
      ).getByText(`+${CANONICAL_TAG}`),
    ).toBeInTheDocument();
  });

  it("marks a novel tag exactly once", () => {
    renderQueue();

    const proposed = screen.getByRole("cell", {
      name: new RegExp(`\\+${NOVEL_TAG}`),
    });
    expect(within(proposed).getAllByText(NOVEL_MARKER)).toHaveLength(1);
    const canonicalTag = within(proposed).getByText(`+${CANONICAL_TAG}`);
    const canonicalGroup = canonicalTag.parentElement;
    if (!canonicalGroup) throw new Error("expected canonical tag group");
    expect(within(canonicalGroup).queryByText(NOVEL_MARKER)).toBeNull();
  });

  it("allows selecting a cap-exceeding row but excludes it from the approve count", async () => {
    const user = userEvent.setup();
    const capCorrection = correction({
      id: "correction-cap-exceeded",
      brandName: "Formoria Cap Review",
      field: "product_tags",
      currentValue: CAP_TAGS,
      proposedValue: { add: [NOVEL_TAG], remove: [] },
    });
    const eligibleCorrection = correction({
      id: "correction-eligible",
      brandName: "Formoria Eligible Review",
      field: "product_type",
      currentValue: "beauty",
      proposedValue: "fashion",
    });
    const bulkReviewAction = vi
      .fn<BulkReviewAction>()
      .mockResolvedValue({ failures: [] });
    renderQueue([capCorrection, eligibleCorrection], { bulkReviewAction });

    expect(CAP_TAGS).toHaveLength(MAX_PRODUCT_TAGS);
    const capCheckbox = screen.getByRole("checkbox", {
      name: `Select ${capCorrection.brandName}`,
    });
    expect(capCheckbox).toBeEnabled();
    expect(capCheckbox).not.toBeChecked();
    await user.click(capCheckbox);
    expect(capCheckbox).toBeChecked();
    await user.click(
      screen.getByRole("checkbox", {
        name: `Select ${eligibleCorrection.brandName}`,
      }),
    );

    const approveButton = screen.getByRole("button", {
      name: messages.admin.corrections.bulkApprove.replace("{count}", "1"),
    });
    expect(approveButton).toBeEnabled();
    expect(
      screen.queryByRole("button", {
        name: messages.admin.corrections.bulkApprove.replace("{count}", "2"),
      }),
    ).toBeNull();
  });

  it("bulk approve calls the array action once with only the selected ids", async () => {
    const user = userEvent.setup();
    const selected = correction({
      id: "correction-selected",
      brandName: "Formoria Selected Review",
      field: "product_type",
      currentValue: "beauty",
      proposedValue: "fashion",
    });
    const unselected = correction({
      id: "correction-unselected",
      brandName: "Formoria Unselected Review",
      field: "social_instagram",
      proposedValue: INSTAGRAM_URL,
    });
    const secondSelected = correction({
      id: "correction-second-selected",
      brandName: "Formoria Second Review",
      field: "purchase_website",
      proposedValue: WEBSITE_URL,
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
        name: messages.admin.corrections.bulkApprove.replace("{count}", "2"),
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

  it("opens the drawer from the disclosure button via keyboard", async () => {
    const user = userEvent.setup();
    renderQueue();

    const disclosure = screen.getByRole("button", {
      name: disclosureName(TAG_CORRECTION.brandName ?? ""),
    });
    disclosure.focus();
    await user.keyboard("{Enter}");

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(
      await screen.findByRole("textbox", {
        name: messages.admin.corrections.reviewerNotes,
      }),
    ).toBeInTheDocument();
  });

  it("renders the empty state when corrections=[]", () => {
    renderQueue([]);

    expect(screen.getByText(messages.admin.corrections.empty)).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", {
        name: messages.admin.queue.search,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: messages.admin.queue.selectAll }),
    ).toBeDisabled();
  });

  it("renders a proposed social link as its raw URL", () => {
    const social = correction({
      id: "correction-social-link",
      brandName: "Formoria Social",
      field: "social_instagram",
      proposedValue: INSTAGRAM_URL,
    });
    renderQueue([social]);

    const row = rowFor(social.brandName ?? "");
    expect(within(row).getByText(INSTAGRAM_URL)).toBeInTheDocument();
    expect(
      within(row).getByText(messages.admin.corrections.fields.social_instagram),
    ).toBeInTheDocument();
    expect(within(row).queryByText(NOT_AVAILABLE)).toBeNull();
  });

  it("renders a proposed purchase link as its raw URL", () => {
    const purchase = correction({
      id: "correction-purchase-link",
      brandName: "Formoria Shop",
      field: "purchase_website",
      proposedValue: WEBSITE_URL,
    });
    renderQueue([purchase]);

    const row = rowFor(purchase.brandName ?? "");
    expect(within(row).getByText(WEBSITE_URL)).toBeInTheDocument();
    expect(
      within(row).getByText(
        messages.admin.corrections.fields.purchase_website,
      ),
    ).toBeInTheDocument();
    expect(within(row).queryByText(NOT_AVAILABLE)).toBeNull();
  });

  it("renders a remove badge for a tag-delta correction", () => {
    renderQueue();

    const cell = within(rowFor(TAG_CORRECTION.brandName ?? "")).getByRole(
      "cell",
      { name: new RegExp(`−${REMOVED_TAG}`) },
    );
    expect(within(cell).getByText(`−${REMOVED_TAG}`)).toBeInTheDocument();
    expect(within(cell).queryByText(NOVEL_MARKER)).toBeNull();
  });
});
