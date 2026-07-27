// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRODUCT_SUBCATEGORIES,
  PRODUCT_TYPE_CATEGORIES,
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

import { CorrectionDialog } from "../correction-dialog";

const BRAND_ID = "d9428888-122b-4e1f-b85c-61c0a8904d6a";

const TRIGGER_NAME = "修正品牌資訊";
const SUBMIT_NAME = "送出修正";
const FIELD_PICKER_LABEL = "要修正哪一項?";
const FIELD_PICKER_PLACEHOLDER = "請選擇要修正的項目…";
const CATEGORY_LABEL = "類別";
const PRICE_RANGE_LABEL = "價格區間";
const CURRENT_HEADING = "目前";
const CURRENT_TAGS_HEADING = "目前（點擊移除）";
const ADD_TAGS_HEADING = "可加入的類別";
const PLACEHOLDER_COPY = "尚未填寫";
const OTHER_CHIP = "其他";
const OTHER_INPUT_LABEL = "其他類別名稱";
const OTHER_CONFIRM = "加入";
const OTHER_CANCEL = "取消";

const PRICE_CHIP = {
  1: "$ · 平價",
  2: "$$ · 中價位",
  3: "$$$ · 高價位",
} as const;

const messages = {
  dashboard: {
    edit: {
      fieldCategory: "分類",
      fieldProductType: "產品類型",
      fieldPriceRange: "價格範圍",
      fieldPriceRangeBudget: "平價",
      fieldPriceRangeMidRange: "中價位",
      fieldPriceRangePremium: "高價位",
      cancel: OTHER_CANCEL,
    },
  },
  brandDetail: {
    label: {
      category: CATEGORY_LABEL,
      priceRange: PRICE_RANGE_LABEL,
      productCategories: "產品類別",
    },
    correction: {
      trigger: "資料有誤?",
      close: "關閉",
      title: TRIGGER_NAME,
      fieldPickerLabel: FIELD_PICKER_LABEL,
      fieldPickerPlaceholder: FIELD_PICKER_PLACEHOLDER,
      description: "感謝您的建議！送出後將由官方審核決定是否更新。",
      submitting: "送出中…",
      submit: SUBMIT_NAME,
      selectPlaceholder: PLACEHOLDER_COPY,
      currentHeading: CURRENT_HEADING,
      currentTagsHeading: CURRENT_TAGS_HEADING,
      changeToHeading: "改成",
      addTagsHeading: ADD_TAGS_HEADING,
      productTagsSubtitle: "{category} 的產品類別（最多 5 項）",
      productTagsSelected: "已選 {count} / 5",
      productTagsLimit: "最多選 5 項產品類別。",
      otherTagChip: OTHER_CHIP,
      otherTagInputLabel: OTHER_INPUT_LABEL,
      otherTagHint: "請輸入 2–8 個字，送出後由官方審核才會更新品牌資料。",
      otherTagConfirm: OTHER_CONFIRM,
      otherTagDuplicate: "這個類別已列在上方，若要移除請點擊上方的標籤。",
      success: "修正已送出。",
      errors: {
        invalid_brand: "品牌無效。",
        invalid_value: "修正無效。",
        too_many_tags: "標籤太多。",
        unchanged: "沒有變更。",
        already_submitted: "已送出。",
        rate_limited: "操作太頻繁，請稍後再試。",
        unavailable: "提交失敗，請稍後再試。",
        tagTooShort: "請輸入 2–8 個字，試試更簡短的類別名稱。",
        tagBlocked: "這個詞無法作為產品類別，請改用能描述產品本身的名稱。",
      },
    },
  },
};

function renderDialog(
  props: Partial<React.ComponentProps<typeof CorrectionDialog>> = {},
) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <CorrectionDialog
        brandId={BRAND_ID}
        brandSlug="warmwood"
        productType="crafts"
        priceRange={2}
        productTags={[]}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: TRIGGER_NAME }));
}

function fieldPicker() {
  return screen.getByRole("combobox", { name: FIELD_PICKER_LABEL });
}

function selectField(field: string) {
  fireEvent.change(fieldPicker(), { target: { value: field } });
}

function group(name: string) {
  return screen.getByRole("group", { name });
}

function chip(groupName: string, name: string) {
  return within(group(groupName)).getByRole("button", { name });
}

function clickChip(groupName: string, name: string) {
  fireEvent.click(chip(groupName, name));
}

function submitButton() {
  return screen.getByRole("button", { name: SUBMIT_NAME });
}

function submit() {
  fireEvent.click(submitButton());
}

function renderProductTags(currentValue: string[] = []) {
  renderDialog({ productType: "home", productTags: currentValue });
}

function openProductTagsDialog() {
  openDialog();
  selectField("product_tags");
}

const HOME_SUBCATEGORIES = PRODUCT_SUBCATEGORIES.filter(
  (subcategory) => subcategory.category === "home",
);

function homeTagsAt(count: number) {
  return HOME_SUBCATEGORIES.slice(0, count).map(
    (subcategory) => subcategory.nameZh,
  );
}

function expandOther() {
  clickChip(ADD_TAGS_HEADING, OTHER_CHIP);
}

function typeOther(value: string) {
  fireEvent.change(screen.getByLabelText(OTHER_INPUT_LABEL), {
    target: { value },
  });
}

function confirmOther() {
  clickChip(ADD_TAGS_HEADING, OTHER_CONFIRM);
}

describe("CorrectionDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitCorrection.mockResolvedValue({ ok: true, id: "correction-1" });
  });

  describe("structure", () => {
    it("renders the current category as a non-interactive reference, not a button", () => {
      renderDialog({ productType: "crafts" });
      openDialog();
      selectField("product_type");

      const current = group(CURRENT_HEADING);
      expect(within(current).getByText("工藝文創")).toBeInTheDocument();
      expect(within(current).queryAllByRole("button")).toHaveLength(0);
    });

    it("excludes the current value from the options row", () => {
      renderDialog({ productType: "crafts" });
      openDialog();
      selectField("product_type");

      expect(screen.getAllByText("工藝文創")).toHaveLength(1);
      expect(
        within(group(CATEGORY_LABEL)).queryByRole("button", {
          name: "工藝文創",
        }),
      ).not.toBeInTheDocument();
    });

    it("renders one option chip per remaining category", () => {
      renderDialog({ productType: "crafts" });
      openDialog();
      selectField("product_type");

      expect(within(group(CATEGORY_LABEL)).getAllByRole("button")).toHaveLength(
        PRODUCT_TYPE_CATEGORIES.length - 1,
      );
    });

    it("renders a placeholder in row 1 when the field is unset", () => {
      renderDialog({ productType: null });
      openDialog();
      selectField("product_type");

      expect(
        within(group(CURRENT_HEADING)).getByText(PLACEHOLDER_COPY),
      ).toBeInTheDocument();
      expect(within(group(CATEGORY_LABEL)).getAllByRole("button")).toHaveLength(
        PRODUCT_TYPE_CATEGORIES.length,
      );
      expect(submitButton()).toBeDisabled();
    });

    it("opens with no value control until a field is picked", () => {
      renderDialog();
      openDialog();

      expect(fieldPicker()).toHaveValue("");
      expect(screen.queryAllByRole("group")).toHaveLength(0);
      expect(submitButton()).toBeDisabled();
    });

    it("swaps the value control when the field changes", () => {
      renderDialog();
      openDialog();

      selectField("product_type");
      expect(group(CATEGORY_LABEL)).toBeInTheDocument();

      selectField("price_range");
      expect(
        screen.queryByRole("group", { name: CATEGORY_LABEL }),
      ).not.toBeInTheDocument();
      expect(group(PRICE_RANGE_LABEL)).toBeInTheDocument();
    });

    it("omits product tags from the field picker when the brand has no category", () => {
      renderDialog({ productType: null });
      openDialog();

      const options = within(fieldPicker()).getAllByRole("option");
      expect(
        options.map((option) => (option as HTMLOptionElement).value),
      ).toEqual(["", "product_type", "price_range"]);
    });
  });

  describe("submit gating", () => {
    it("submit is disabled until a different value is chosen", () => {
      renderDialog();
      openDialog();
      selectField("price_range");

      expect(submitButton()).toBeDisabled();
      expect(submitButton()).toHaveAttribute("data-ph-no-autocapture");

      clickChip(PRICE_RANGE_LABEL, PRICE_CHIP[3]);

      expect(submitButton()).toBeEnabled();
    });

    it("re-clicking the selected chip returns to the baseline and re-disables submit", () => {
      renderDialog();
      openDialog();
      selectField("price_range");

      clickChip(PRICE_RANGE_LABEL, PRICE_CHIP[3]);
      expect(chip(PRICE_RANGE_LABEL, PRICE_CHIP[3])).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(submitButton()).toBeEnabled();

      clickChip(PRICE_RANGE_LABEL, PRICE_CHIP[3]);
      expect(chip(PRICE_RANGE_LABEL, PRICE_CHIP[3])).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(submitButton()).toBeDisabled();
    });

    it("submit stays disabled while the tag set is unchanged", () => {
      renderProductTags(["寢具", "家具"]);
      openProductTagsDialog();

      expect(submitButton()).toBeDisabled();

      clickChip(ADD_TAGS_HEADING, "床墊");
      expect(submitButton()).toBeEnabled();

      clickChip(ADD_TAGS_HEADING, "床墊");
      expect(submitButton()).toBeDisabled();
    });
  });

  describe("delta payload", () => {
    it("submits a scalar proposedValue", async () => {
      renderDialog();
      openDialog();
      selectField("price_range");

      clickChip(PRICE_RANGE_LABEL, PRICE_CHIP[3]);
      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith({
          brandId: BRAND_ID,
          field: "price_range",
          proposedValue: 3,
        });
      });
      expect(mocks.trackCorrectionSubmitted).toHaveBeenCalledWith(
        BRAND_ID,
        "warmwood",
        "price_range",
      );
      expect(mocks.toastSuccess).toHaveBeenCalledWith("修正已送出。");
      await waitFor(() => {
        expect(screen.queryAllByRole("group")).toHaveLength(0);
      });
    });

    it("submits an add/remove delta, not a full set", async () => {
      renderProductTags(["寢具", "家具"]);
      openProductTagsDialog();

      clickChip(ADD_TAGS_HEADING, "床墊");
      clickChip(CURRENT_TAGS_HEADING, "家具");
      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith({
          brandId: BRAND_ID,
          field: "product_tags",
          proposedValue: { add: ["床墊"], remove: ["家具"] },
        });
      });
    });

    it("uses canonical nameZh in both delta arrays", async () => {
      renderProductTags(["寢具"]);
      openProductTagsDialog();

      clickChip(CURRENT_TAGS_HEADING, "寢具");
      clickChip(ADD_TAGS_HEADING, "床墊");
      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith(
          expect.objectContaining({
            proposedValue: { add: ["床墊"], remove: ["寢具"] },
          }),
        );
      });
      expect(mocks.submitCorrection).not.toHaveBeenCalledWith(
        expect.objectContaining({
          proposedValue: { add: ["mattresses"], remove: ["Bedding"] },
        }),
      );
    });

    it("omits untouched tags from the delta", async () => {
      renderProductTags(["寢具", "家具"]);
      openProductTagsDialog();

      clickChip(ADD_TAGS_HEADING, "床墊");
      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith({
          brandId: BRAND_ID,
          field: "product_tags",
          proposedValue: { add: ["床墊"], remove: [] },
        });
      });
    });

    it("emits a remove-only delta", async () => {
      renderProductTags(["寢具", "上衣・T恤"]);
      openProductTagsDialog();

      clickChip(CURRENT_TAGS_HEADING, "上衣・T恤");
      expect(screen.getByText("已選 1 / 5")).toBeInTheDocument();

      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith({
          brandId: BRAND_ID,
          field: "product_tags",
          proposedValue: { add: [], remove: ["上衣・T恤"] },
        });
      });
    });

    it("surfaces the rate_limited error toast", async () => {
      mocks.submitCorrection.mockResolvedValue({
        ok: false,
        error: "rate_limited",
      });
      renderDialog();
      openDialog();
      selectField("price_range");

      clickChip(PRICE_RANGE_LABEL, PRICE_CHIP[3]);
      submit();

      await waitFor(() => {
        expect(mocks.toastError).toHaveBeenCalledWith(
          "操作太頻繁，請稍後再試。",
        );
      });
    });
  });

  describe("tag rows", () => {
    // A `home` brand can still carry `fashion` tags: normalizeProductTags keeps
    // cross-branch tags, and approving a product_type correction moves the
    // category without re-deriving product_tags. Those tags consume the 5-tag
    // cap, so they have to stay visible and removable.
    it("renders every current tag in row 1, including out-of-category ones", () => {
      renderProductTags(["寢具", "上衣・T恤"]);
      openProductTagsDialog();

      const current = group(CURRENT_TAGS_HEADING);
      expect(
        within(current).getByRole("button", { name: "寢具" }),
      ).toBeEnabled();
      const offCategory = within(current).getByRole("button", {
        name: "上衣・T恤",
      });
      expect(offCategory).toBeEnabled();
      expect(offCategory).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("已選 2 / 5")).toBeInTheDocument();
    });

    it("row 1 tags start pressed and flip to unpressed when marked for removal", () => {
      renderProductTags(["寢具"]);
      openProductTagsDialog();

      expect(chip(CURRENT_TAGS_HEADING, "寢具")).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      clickChip(CURRENT_TAGS_HEADING, "寢具");

      expect(chip(CURRENT_TAGS_HEADING, "寢具")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByText("已選 0 / 5")).toBeInTheDocument();
    });

    it("row 2 excludes tags already held", () => {
      renderProductTags(["寢具"]);
      openProductTagsDialog();

      const options = group(ADD_TAGS_HEADING);
      expect(
        within(options).queryByRole("button", { name: "寢具" }),
      ).not.toBeInTheDocument();
      // Remaining in-category subcategories plus the 其他 chip.
      expect(within(options).getAllByRole("button")).toHaveLength(
        HOME_SUBCATEGORIES.length - 1 + 1,
      );
      for (const subcategory of HOME_SUBCATEGORIES.filter(
        (item) => item.nameZh !== "寢具",
      )) {
        expect(
          within(options).getByRole("button", {
            name: subcategoryLabel(subcategory, "zh-TW"),
          }),
        ).toBeInTheDocument();
      }
    });

    it("counts out-of-category and novel tags against the 5 cap", () => {
      renderProductTags(["上衣・T恤", "褲裝", "裙裝", "洋裝"]);
      openProductTagsDialog();

      expect(screen.getByText("已選 4 / 5")).toBeInTheDocument();

      expandOther();
      typeOther("藤編椅");
      confirmOther();

      expect(screen.getByText("已選 5 / 5")).toBeInTheDocument();
      expect(screen.getByText("最多選 5 項產品類別。")).toBeInTheDocument();
      expect(chip(ADD_TAGS_HEADING, "寢具")).toBeDisabled();
    });

    it("disables unselected row-2 chips at the cap while pressed ones stay enabled", () => {
      const currentTags = homeTagsAt(5);
      renderProductTags(currentTags);
      openProductTagsDialog();

      expect(screen.getByText("已選 5 / 5")).toBeInTheDocument();

      const options = within(group(ADD_TAGS_HEADING)).getAllByRole("button");
      expect(options.length).toBeGreaterThan(0);
      expect(options.every((button) => button.hasAttribute("disabled"))).toBe(
        true,
      );

      for (const tag of currentTags) {
        expect(chip(CURRENT_TAGS_HEADING, tag)).toBeEnabled();
      }
    });

    it("resets the selection after a successful submit", async () => {
      renderProductTags(["寢具"]);
      openProductTagsDialog();

      clickChip(ADD_TAGS_HEADING, "床墊");
      submit();

      await waitFor(() => {
        expect(screen.queryAllByRole("group")).toHaveLength(0);
      });

      openProductTagsDialog();

      expect(chip(CURRENT_TAGS_HEADING, "寢具")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(chip(ADD_TAGS_HEADING, "床墊")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByText("已選 1 / 5")).toBeInTheDocument();
      expect(submitButton()).toBeDisabled();
    });
  });

  describe("other tag flow", () => {
    it("canonicalizes an alias to its nameZh instead of adding the typed string", () => {
      renderProductTags([]);
      openProductTagsDialog();

      expandOther();
      typeOther("T恤");
      confirmOther();

      const added = chip(ADD_TAGS_HEADING, "上衣・T恤");
      expect(added).toHaveAttribute("aria-pressed", "true");
      expect(
        within(group(ADD_TAGS_HEADING)).queryByRole("button", { name: "T恤" }),
      ).not.toBeInTheDocument();
    });

    it("selects the existing row-2 chip when the typed value is already offered", () => {
      renderProductTags([]);
      openProductTagsDialog();

      expandOther();
      typeOther("床包");
      confirmOther();

      const options = group(ADD_TAGS_HEADING);
      expect(
        within(options).getAllByRole("button", { name: "寢具" }),
      ).toHaveLength(1);
      expect(chip(ADD_TAGS_HEADING, "寢具")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("appends a cross-category canonical tag as a selected chip", () => {
      renderProductTags([]);
      openProductTagsDialog();

      expandOther();
      typeOther("洋裝");
      confirmOther();

      expect(chip(ADD_TAGS_HEADING, "洋裝")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByText("已選 1 / 5")).toBeInTheDocument();
    });

    it("appends an accepted novel tag as a selected chip", async () => {
      renderProductTags([]);
      openProductTagsDialog();

      expandOther();
      typeOther("藤編椅");
      confirmOther();

      expect(chip(ADD_TAGS_HEADING, "藤編椅")).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith({
          brandId: BRAND_ID,
          field: "product_tags",
          proposedValue: { add: ["藤編椅"], remove: [] },
        });
      });
    });

    it("shows an inline reason for a blocklisted entry and does not add it", () => {
      renderProductTags([]);
      openProductTagsDialog();

      expandOther();
      typeOther("限定");
      confirmOther();

      const input = screen.getByLabelText(OTHER_INPUT_LABEL);
      expect(input).toHaveAttribute("aria-invalid", "true");
      const describedBy = input.getAttribute("aria-describedby") ?? "";
      expect(describedBy).not.toBe("");
      const messageIds = describedBy.split(" ");
      const text = messageIds
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      expect(text).toContain(
        "這個詞無法作為產品類別，請改用能描述產品本身的名稱。",
      );
      expect(
        within(group(ADD_TAGS_HEADING)).queryByRole("button", {
          name: "限定",
        }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("已選 0 / 5")).toBeInTheDocument();
    });

    it("shows an inline reason for a too-short entry and does not add it", () => {
      renderProductTags([]);
      openProductTagsDialog();

      expandOther();
      typeOther("杯");
      confirmOther();

      expect(screen.getByLabelText(OTHER_INPUT_LABEL)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(
        screen.getByText("請輸入 2–8 個字，試試更簡短的類別名稱。"),
      ).toBeInTheDocument();
      expect(screen.getByText("已選 0 / 5")).toBeInTheDocument();
    });

    it("reports a duplicate when the typed value is already in row 1", () => {
      renderProductTags(["寢具"]);
      openProductTagsDialog();

      expandOther();
      typeOther("床包");
      confirmOther();

      expect(
        screen.getByText("這個類別已列在上方，若要移除請點擊上方的標籤。"),
      ).toBeInTheDocument();
      expect(screen.getByText("已選 1 / 5")).toBeInTheDocument();
      expect(
        within(group(CURRENT_TAGS_HEADING)).getAllByRole("button", {
          name: "寢具",
        }),
      ).toHaveLength(1);
    });

    it("disables the 其他 affordance at the 5-tag cap", () => {
      renderProductTags(homeTagsAt(5));
      openProductTagsDialog();

      expect(chip(ADD_TAGS_HEADING, OTHER_CHIP)).toBeDisabled();
      expect(
        screen.queryByLabelText(OTHER_INPUT_LABEL),
      ).not.toBeInTheDocument();
    });

    it("returns focus to the 其他 chip when the entry is cancelled", () => {
      renderProductTags([]);
      openProductTagsDialog();

      expandOther();
      expect(screen.getByLabelText(OTHER_INPUT_LABEL)).toHaveFocus();

      clickChip(ADD_TAGS_HEADING, OTHER_CANCEL);

      expect(
        screen.queryByLabelText(OTHER_INPUT_LABEL),
      ).not.toBeInTheDocument();
      expect(chip(ADD_TAGS_HEADING, OTHER_CHIP)).toHaveFocus();
    });
  });
});
