// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { BrandCorrection } from "@/lib/services/brand-corrections";
import messages from "../../../../messages/zh-TW.json";
import { CorrectionsQueue } from "../corrections-queue";

function makeCorrection(
  overrides: Partial<BrandCorrection> = {},
): BrandCorrection {
  return {
    id: "correction-1",
    brandId: "brand-1",
    field: "price_range",
    proposedValue: 2,
    previousValue: 1,
    visitorHash: null,
    status: "pending",
    reviewedAt: null,
    reviewedBy: null,
    reviewerNotes: null,
    createdAt: "2026-07-20T10:00:00Z",
    brandName: "測試品牌",
    brandSlug: "test-brand",
    stale: false,
    ...overrides,
  };
}

function renderQueue(
  corrections: BrandCorrection[],
  reviewAction?: (
    id: string,
    decision: "approved" | "rejected",
    notes: string,
  ) => Promise<{ error?: string } | undefined>,
) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <CorrectionsQueue corrections={corrections} reviewAction={reviewAction} />
    </NextIntlClientProvider>,
  );
}

describe("CorrectionsQueue", () => {
  it("renders a row per pending correction with before and after values", () => {
    renderQueue([
      makeCorrection({
        id: "price-correction",
        field: "price_range",
        previousValue: 1,
        proposedValue: 3,
        brandName: "價格品牌",
      }),
      makeCorrection({
        id: "type-correction",
        field: "product_type",
        previousValue: "fashion",
        proposedValue: "home",
        brandName: "居家品牌",
      }),
    ]);

    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("價格品牌")).toBeInTheDocument();
    expect(screen.getByText("居家品牌")).toBeInTheDocument();
    expect(screen.getByText("$")).toBeInTheDocument();
    expect(screen.getByText("$$$")).toBeInTheDocument();
    expect(screen.getByText("服飾鞋履")).toBeInTheDocument();
    expect(screen.getByText("居家生活")).toBeInTheDocument();
  });

  it("renders a tag delta as additions and removals", () => {
    renderQueue([
      makeCorrection({
        field: "product_tags",
        previousValue: ["香氛"],
        proposedValue: { add: ["燈具"], remove: ["香氛"] },
      }),
    ]);

    expect(screen.getByText("+燈具")).toBeInTheDocument();
    expect(screen.getByText("−香氛")).toBeInTheDocument();
    expect(screen.getByText("套用後結果")).toBeInTheDocument();
    expect(screen.getByText("燈具")).toBeInTheDocument();
  });

  it("renders a stale warning when the brand value changed since submission", () => {
    renderQueue([
      makeCorrection({ id: "fresh", brandName: "最新品牌" }),
      makeCorrection({
        id: "stale",
        brandName: "已變更品牌",
        stale: true,
      }),
    ]);

    expect(screen.getAllByText("提交後，品牌資料已變更")).toHaveLength(1);
  });

  it("warns when a tag delta would exceed the 5-tag cap against the current value", async () => {
    const user = userEvent.setup();
    const correction = {
      ...makeCorrection({
        field: "product_tags",
        previousValue: ["上衣", "褲裝", "裙裝", "鞋子"],
        proposedValue: { add: ["燈具"], remove: [] },
      }),
      currentValue: ["上衣", "褲裝", "裙裝", "鞋子", "包袋"],
    };

    renderQueue([correction]);

    expect(
      screen.getByText("無法核准：套用後會超過 5 個產品標籤"),
    ).toBeInTheDocument();

    await user.click(screen.getByText("測試品牌"));
    expect(screen.getByRole("button", { name: "核准" })).toBeDisabled();
  });

  it("calls reviewAction with approved on approve", async () => {
    const user = userEvent.setup();
    const reviewAction = vi.fn().mockResolvedValue(undefined);

    renderQueue([makeCorrection()], reviewAction);

    await user.click(screen.getByText("測試品牌"));
    await user.type(screen.getByLabelText("審核備註"), "確認品牌資料");
    await user.click(screen.getByRole("button", { name: "核准" }));

    await waitFor(() => {
      expect(reviewAction).toHaveBeenCalledWith(
        "correction-1",
        "approved",
        "確認品牌資料",
      );
    });
  });

  it("calls reviewAction with rejected on reject", async () => {
    const user = userEvent.setup();
    const reviewAction = vi.fn().mockResolvedValue(undefined);

    renderQueue([makeCorrection()], reviewAction);

    await user.click(screen.getByText("測試品牌"));
    await user.type(screen.getByLabelText("審核備註"), "資料不足");
    await user.click(screen.getByRole("button", { name: "拒絕" }));

    await waitFor(() => {
      expect(reviewAction).toHaveBeenCalledWith(
        "correction-1",
        "rejected",
        "資料不足",
      );
    });
  });

  it("renders an empty state when there are no pending corrections", () => {
    renderQueue([]);

    expect(screen.getByText("目前沒有待審核的品牌修正。")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
