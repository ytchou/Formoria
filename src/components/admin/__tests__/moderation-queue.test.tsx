// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/en.json";
import type { FlaggedContentItem } from "@/lib/services/moderation";
import { updateModerationFlagStatus } from "@/lib/services/moderation";
import { ModerationQueue } from "../moderation-queue";

type ReviewAction = (
  id: string,
  decision: "reviewed" | "dismissed",
  notes?: string,
) => Promise<{ error?: string } | undefined>;

function flaggedContent(
  overrides: Partial<FlaggedContentItem> & { id: string; brandName: string },
): FlaggedContentItem & { brandName: string } {
  const { id, brandName, ...rest } = overrides;
  return {
    id,
    brandId: "3f0a9d21-77c4-4e58-9b12-0d6e5c8a4471",
    brandName,
    fieldName: "description",
    reason: "contact_injection_phone",
    flaggedContent: "Phone numbers are not allowed in this field",
    status: "pending",
    createdAt: "2026-07-27T00:00:00.000Z",
    ...rest,
  };
}

function renderQueue(items: FlaggedContentItem[], decideAction?: ReviewAction) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ModerationQueue items={items} decideAction={decideAction} />
    </NextIntlClientProvider>,
  );
}

describe("ModerationQueue", () => {
  it("moderation renders no tabs, filters, search, or pagination", () => {
    renderQueue([
      flaggedContent({
        id: "11e4c6a0-2b95-4d17-8f3a-6c07b912de45",
        brandName: "Formoria Moderation Review",
      }),
    ]);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("searchbox")).toHaveLength(0);
    expect(screen.queryByText(messages.admin.queue.pageSize)).toBeNull();
    expect(
      screen.queryByRole("button", { name: messages.admin.queue.previousPage }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: messages.admin.queue.nextPage }),
    ).toBeNull();
  });

  it("moderation decides a flag inline", async () => {
    const user = userEvent.setup();
    const item = flaggedContent({
      id: "22a7f3d9-4c81-4be2-9d06-7e15a840cb32",
      brandName: "Formoria Inline Review",
    });
    const decideAction = vi.fn<ReviewAction>().mockResolvedValue(undefined);
    renderQueue([item], decideAction);

    await user.click(
      screen.getByRole("button", {
        name: messages.admin.moderation.markReviewed,
      }),
    );

    await waitFor(() => {
      expect(decideAction).toHaveBeenCalledWith(item.id, "reviewed");
    });
  });

  it("moderation surfaces a decision error inline", async () => {
    const user = userEvent.setup();
    const item = flaggedContent({
      id: "33b8e5c2-1f60-4a93-b48d-9c02f6e71da5",
      brandName: "Formoria Failed Review",
    });
    const error = "Moderation flag is no longer pending";
    const decideAction = vi.fn<ReviewAction>().mockResolvedValue({ error });
    renderQueue([item], decideAction);

    await user.click(
      screen.getByRole("button", {
        name: messages.admin.moderation.markReviewed,
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(error);
    });
  });

  it("moderation records reviewer attribution", async () => {
    const flagId = "44d1a7b6-3e29-4c05-8a71-b6f3c9e2408d";
    const reviewerId = "55e2b8c7-4f30-5d16-9b82-c7f4d0a3519e";
    const claim = vi
      .fn()
      .mockResolvedValue({ data: { id: flagId }, error: null });
    await updateModerationFlagStatus(
      flagId,
      "reviewed",
      { reviewerId },
      { claim },
    );
    expect(claim).toHaveBeenCalledWith(
      flagId,
      expect.objectContaining({ status: "reviewed", reviewed_by: reviewerId }),
    );
  });
});
