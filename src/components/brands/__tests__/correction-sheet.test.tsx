// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRODUCT_SUBCATEGORIES,
  subcategoryLabel,
} from "@/lib/taxonomy/ontology";

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
      selectPlaceholder: "尚未填寫，請選擇…",
      productTagsTitle: "修正產品類別",
      productTagsSubtitle: "{category} 的產品類別（最多 5 項）",
      productTagsSelected: "已選 {count} / 5",
      productTagsLimit: "最多選 5 項產品類別。",
      productTagsOtherCategory: "其他分類的既有標籤",
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

function renderProductTags(currentValue: string[] = []) {
  renderSheet({
    field: "product_tags",
    currentValue,
    categorySlug: "home",
  });
}

function openProductTagsSheet() {
  openSheet("修正產品類別");
}

function productTagCheckbox(name: string) {
  return screen.getByRole("checkbox", { name });
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

  it("shows a disabled placeholder as the selected option when there is no current value", () => {
    renderSheet({ currentValue: null });
    openSheet();

    const select = screen.getByRole("combobox");
    const placeholder = screen.getByRole("option", { name: "尚未填寫，請選擇…" });

    expect(select).toHaveValue("");
    expect(placeholder).toBeDisabled();
    expect((placeholder as HTMLOptionElement).selected).toBe(true);
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("gates submit on the placeholder when there is no current value", () => {
    renderSheet({ currentValue: null });
    openSheet();

    const select = screen.getByRole("combobox");
    const submit = screen.getByRole("button", { name: "送出修正" });
    expect(submit).toBeDisabled();

    fireEvent.change(select, { target: { value: "3" } });
    expect(submit).toBeEnabled();

    fireEvent.change(select, { target: { value: "" } });
    expect(select).toHaveValue("");
    expect(submit).toBeDisabled();
  });

  it("shows the placeholder for a category with no current value", () => {
    renderSheet({ field: "product_type", currentValue: null });
    openSheet("修正類別");

    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(
      screen.getByRole("option", { name: "尚未填寫，請選擇…" }),
    ).toBeDisabled();
    expect(screen.getAllByRole("option")).toHaveLength(13);
    expect(screen.getByRole("button", { name: "送出修正" })).toBeDisabled();
  });

  it("omits the placeholder when a current value exists", () => {
    renderSheet();
    openSheet();

    expect(
      screen.queryByRole("option", { name: "尚未填寫，請選擇…" }),
    ).not.toBeInTheDocument();
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

  it("renders only subcategories belonging to the brand's category", () => {
    const homeSubcategories = PRODUCT_SUBCATEGORIES.filter(
      (subcategory) => subcategory.category === "home",
    );
    expect(homeSubcategories).toHaveLength(22);

    renderProductTags();
    openProductTagsSheet();

    expect(screen.getAllByRole("checkbox")).toHaveLength(22);
    for (const subcategory of homeSubcategories) {
      expect(
        productTagCheckbox(subcategoryLabel(subcategory, "zh-TW")),
      ).toBeInTheDocument();
    }
    for (const subcategory of PRODUCT_SUBCATEGORIES.filter(
      (item) => item.category !== "home",
    )) {
      expect(
        screen.queryByRole("checkbox", {
          name: subcategoryLabel(subcategory, "zh-TW"),
        }),
      ).not.toBeInTheDocument();
    }
  });

  it("preselects the brand's current tags", () => {
    renderProductTags(["寢具", "家具"]);
    openProductTagsSheet();

    expect(productTagCheckbox("寢具")).toBeChecked();
    expect(productTagCheckbox("家具")).toBeChecked();
    expect(productTagCheckbox("床墊")).not.toBeChecked();
  });

  it("disables unchecked options once 5 are selected", () => {
    const selectedTags = PRODUCT_SUBCATEGORIES.filter(
      (subcategory) => subcategory.category === "home",
    )
      .slice(0, 5)
      .map((subcategory) => subcategory.nameZh);

    renderProductTags(selectedTags);
    openProductTagsSheet();

    const unchecked = screen
      .getAllByRole("checkbox")
      .filter((checkbox) => !(checkbox as HTMLInputElement).checked);
    expect(unchecked).toHaveLength(17);
    expect(unchecked.every((checkbox) => checkbox.hasAttribute("disabled"))).toBe(
      true,
    );
    expect(screen.getByText("最多選 5 項產品類別。")).toBeInTheDocument();
  });

  it("keeps checked options enabled at the limit so they can be removed", () => {
    const selectedTags = PRODUCT_SUBCATEGORIES.filter(
      (subcategory) => subcategory.category === "home",
    )
      .slice(0, 5)
      .map((subcategory) => subcategory.nameZh);

    renderProductTags(selectedTags);
    openProductTagsSheet();

    for (const tag of selectedTags) {
      expect(productTagCheckbox(tag)).toBeEnabled();
    }
  });

  it("shows the selected count as N / 5", () => {
    renderProductTags(["寢具", "家具"]);
    openProductTagsSheet();

    expect(screen.getByText("已選 2 / 5")).toBeInTheDocument();

    fireEvent.click(productTagCheckbox("床墊"));

    expect(screen.getByText("已選 3 / 5")).toBeInTheDocument();
  });

  it("submits a delta, not the full set", async () => {
    renderProductTags(["寢具", "家具"]);
    openProductTagsSheet();

    fireEvent.click(productTagCheckbox("床墊"));
    fireEvent.click(productTagCheckbox("家具"));
    fireEvent.click(screen.getByRole("button", { name: "送出修正" }));

    await waitFor(() => {
      expect(mocks.submitCorrection).toHaveBeenCalledWith({
        brandId: BRAND_ID,
        field: "product_tags",
        proposedValue: {
          add: ["床墊"],
          remove: ["家具"],
        },
      });
    });
  });

  it("submits canonical nameZh values in both delta arrays", async () => {
    renderProductTags(["寢具"]);
    openProductTagsSheet();

    fireEvent.click(productTagCheckbox("寢具"));
    fireEvent.click(productTagCheckbox("床墊"));
    fireEvent.click(screen.getByRole("button", { name: "送出修正" }));

    await waitFor(() => {
      expect(mocks.submitCorrection).toHaveBeenCalledWith(
        expect.objectContaining({
          proposedValue: {
            add: ["床墊"],
            remove: ["寢具"],
          },
        }),
      );
    });
    expect(mocks.submitCorrection).not.toHaveBeenCalledWith(
      expect.objectContaining({
        proposedValue: {
          add: ["mattresses"],
          remove: ["Bedding"],
        },
      }),
    );
  });

  it("omits untouched tags from the delta", async () => {
    renderProductTags(["寢具", "家具"]);
    openProductTagsSheet();

    fireEvent.click(productTagCheckbox("床墊"));
    fireEvent.click(screen.getByRole("button", { name: "送出修正" }));

    await waitFor(() => {
      expect(mocks.submitCorrection).toHaveBeenCalledWith({
        brandId: BRAND_ID,
        field: "product_tags",
        proposedValue: {
          add: ["床墊"],
          remove: [],
        },
      });
    });
  });

  // A `home` brand can still carry `fashion` tags: normalizeProductTags keeps
  // cross-branch tags, and approving a product_type correction moves the
  // category without re-deriving product_tags. Those tags consume the 5-tag
  // cap, so they have to be visible and removable.
  it("renders out-of-category tags as checked, removable rows", () => {
    renderProductTags(["寢具", "上衣・T恤"]);
    openProductTagsSheet();

    expect(screen.getByText("其他分類的既有標籤")).toBeInTheDocument();

    const offCategory = productTagCheckbox("上衣・T恤");
    expect(offCategory).toBeChecked();
    expect(offCategory).toBeEnabled();
    expect(productTagCheckbox("寢具")).toBeChecked();
    expect(screen.getByText("已選 2 / 5")).toBeInTheDocument();
  });

  it("counts out-of-category tags against the 5-tag cap", () => {
    renderProductTags(["上衣・T恤", "褲裝", "裙裝", "洋裝", "外套"]);
    openProductTagsSheet();

    expect(screen.getByText("已選 5 / 5")).toBeInTheDocument();
    expect(screen.getByText("最多選 5 項產品類別。")).toBeInTheDocument();
    expect(productTagCheckbox("上衣・T恤")).toBeEnabled();
    expect(productTagCheckbox("寢具")).toBeDisabled();
  });

  it("emits a remove-only delta when an out-of-category tag is unchecked", async () => {
    renderProductTags(["寢具", "上衣・T恤"]);
    openProductTagsSheet();

    fireEvent.click(productTagCheckbox("上衣・T恤"));

    expect(productTagCheckbox("上衣・T恤")).not.toBeChecked();
    expect(screen.getByText("已選 1 / 5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "送出修正" }));

    await waitFor(() => {
      expect(mocks.submitCorrection).toHaveBeenCalledWith({
        brandId: BRAND_ID,
        field: "product_tags",
        proposedValue: {
          add: [],
          remove: ["上衣・T恤"],
        },
      });
    });
  });

  it("resets the scalar selection to the current value after a successful submit", async () => {
    renderSheet();
    openSheet();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "送出修正" }));

    await waitFor(() => {
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    openSheet();

    expect(screen.getByRole("combobox")).toHaveValue("2");
    expect(screen.getByRole("button", { name: "送出修正" })).toBeDisabled();
  });

  it("resets the tag selection to the current tags after a successful submit", async () => {
    renderProductTags(["寢具"]);
    openProductTagsSheet();

    fireEvent.click(productTagCheckbox("床墊"));
    fireEvent.click(screen.getByRole("button", { name: "送出修正" }));

    await waitFor(() => {
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    openProductTagsSheet();

    expect(productTagCheckbox("寢具")).toBeChecked();
    expect(productTagCheckbox("床墊")).not.toBeChecked();
    expect(screen.getByText("已選 1 / 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送出修正" })).toBeDisabled();
  });
});
