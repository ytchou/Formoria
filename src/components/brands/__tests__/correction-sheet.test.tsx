// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  submitCorrection: vi.fn(),
  trackCorrectionSubmitted: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/actions/brand-corrections", () => ({
  submitCorrectionAction: mocks.submitCorrection,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/lib/analytics", () => ({
  trackCorrectionSubmitted: mocks.trackCorrectionSubmitted,
}));

import { CorrectionSheet } from "../correction-sheet";

const BRAND_ID = "d9428888-122b-4e1f-b85c-61c0a8904d6a";

const messages = {
  dashboard: {
    edit: {
      fieldCategory: "分類",
      fieldProductType: "產品類型",
      fieldPriceRange: "價格範圍",
      fieldPriceRangeBudget: "平價",
      fieldPriceRangeMidRange: "中價位",
      fieldPriceRangePremium: "高價位",
      cancel: "取消",
    },
  },
  brandDetail: {
    label: {
      category: "類別",
      priceRange: "價格區間",
      productCategories: "產品類別",
    },
    correction: {
      trigger: "這不對?",
      triggerLabel: "修正{field}",
      description: "送出後由編輯審核，通過才會更新。",
      submitting: "送出中…",
      submit: "送出修正",
      success: "修正已送出。",
      errors: {
        invalid_brand: "品牌無效。",
        invalid_value: "修正無效。",
        too_many_tags: "標籤太多。",
        unchanged: "沒有變更。",
        already_submitted: "已送出。",
        rate_limited: "操作太頻繁，請稍後再試。",
        unavailable: "提交失敗，請稍後再試。",
      },
    },
  },
};

function renderSheet(
  props: Partial<React.ComponentProps<typeof CorrectionSheet>> = {},
) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <CorrectionSheet
        brandId={BRAND_ID}
        brandSlug="warmwood"
        field="price_range"
        currentValue={2}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

function openSheet(name = "修正價格區間") {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("CorrectionSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitCorrection.mockResolvedValue({ ok: true, id: "correction-1" });
  });

  it("renders the three price options with current value preselected", () => {
    renderSheet();
    openSheet();

    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("2");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(
      screen.getByRole("option", { name: "$ · 平價" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "$$ · 中價位" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "$$$ · 高價位" }),
    ).toBeInTheDocument();
  });

  it("renders all 12 category options with current value preselected", () => {
    renderSheet({ field: "product_type", currentValue: "crafts" });
    openSheet("修正類別");

    expect(screen.getByRole("combobox")).toHaveValue("crafts");
    expect(screen.getAllByRole("option")).toHaveLength(12);
    expect(
      screen.getByRole("option", { name: "工藝文創" }),
    ).toBeInTheDocument();
  });

  it("disables submit until the selection differs from current", () => {
    renderSheet();
    openSheet();

    const submit = screen.getByRole("button", { name: "送出修正" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("data-ph-no-autocapture");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "3" } });

    expect(submit).toBeEnabled();
  });

  it("re-disables submit when the selection returns to the original value", () => {
    renderSheet();
    openSheet();

    const select = screen.getByRole("combobox");
    const submit = screen.getByRole("button", { name: "送出修正" });

    fireEvent.change(select, { target: { value: "3" } });
    expect(submit).toBeEnabled();

    fireEvent.change(select, { target: { value: "2" } });
    expect(submit).toBeDisabled();
  });

  it("shows the rate-limit message on a rate_limited result", async () => {
    mocks.submitCorrection.mockResolvedValue({
      ok: false,
      error: "rate_limited",
    });
    renderSheet();
    openSheet();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "送出修正" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("操作太頻繁，請稍後再試。");
    });
  });

  it("closes and shows a success message on ok", async () => {
    renderSheet();
    openSheet();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "送出修正" }));

    await waitFor(() => {
      expect(mocks.submitCorrection).toHaveBeenCalledWith({
        brandId: BRAND_ID,
        field: "price_range",
        proposedValue: 3,
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith("修正已送出。");
      expect(mocks.trackCorrectionSubmitted).toHaveBeenCalledWith(
        BRAND_ID,
        "warmwood",
        "price_range",
      );
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });
  });
});
