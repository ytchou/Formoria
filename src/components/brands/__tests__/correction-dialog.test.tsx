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
  L2_SUBCATEGORIES,
  L1_CATEGORIES,
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

import messages from "../../../../messages/zh-TW.json";
import { CorrectionDialog } from "../correction-dialog";

const BRAND_ID = "d9428888-122b-4e1f-b85c-61c0a8904d6a";

// The real locale file is the fixture: a dropped or renamed key then fails the
// suite instead of surfacing as a raw key path at runtime.
const COPY = messages.brandDetail.correction;
const EDIT_COPY = messages.dashboard.edit;

// The trigger has no aria-label — its visible text is its accessible name.
const TRIGGER_NAME = COPY.trigger;
const SUBMIT_NAME = COPY.submit;
const FIELD_PICKER_LABEL = COPY.fieldPickerLabel;
const CATEGORY_LABEL = messages.brandDetail.label.category;
const PRICE_RANGE_LABEL = messages.brandDetail.label.priceRange;
const CURRENT_HEADING = COPY.currentHeading;
const CHANGE_TO_HEADING = COPY.changeToHeading;
const CURRENT_TAGS_HEADING = COPY.currentSubcategoriesHeading;
const ADD_TAGS_HEADING = COPY.addSubcategoriesHeading;
const PLACEHOLDER_COPY = COPY.selectPlaceholder;
const OTHER_CHIP = COPY.otherSubcategoryChip;
const OTHER_INPUT_LABEL = COPY.otherSubcategoryInputLabel;
const OTHER_CONFIRM = COPY.otherSubcategoryConfirm;
const OTHER_CANCEL = EDIT_COPY.cancel;

const PRICE_CHIP = {
  1: `$ · ${EDIT_COPY.fieldPriceRangeBudget}`,
  2: `$$ · ${EDIT_COPY.fieldPriceRangeMidRange}`,
  3: `$$$ · ${EDIT_COPY.fieldPriceRangePremium}`,
} as const;

function selectedCount(count: number) {
  return COPY.subcategoriesSelected.replace("{count}", String(count));
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof CorrectionDialog>> = {},
) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <CorrectionDialog
        brandId={BRAND_ID}
        brandSlug="warmwood"
        categorySlug="crafts"
        priceRange={2}
        subcategories={[]}
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

function renderSubcategories(currentValue: string[] = []) {
  renderDialog({ categorySlug: "home", subcategories: currentValue });
}

function openSubcategoriesDialog() {
  openDialog();
  selectField("subcategories");
}

const HOME_SUBCATEGORIES = L2_SUBCATEGORIES.filter(
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
      renderDialog({ categorySlug: "crafts" });
      openDialog();
      selectField("category");

      const current = group(CURRENT_HEADING);
      expect(within(current).getByText("工藝文創")).toBeInTheDocument();
      expect(within(current).queryAllByRole("button")).toHaveLength(0);
    });

    // The dialog reads as a diff: 目前 / 改成. The field label stays the group's
    // accessible name so the row is still addressable as 類別 / 價格區間.
    it("heads the options row with 改成 while keeping the field label as its name", () => {
      renderDialog({ categorySlug: "crafts" });
      openDialog();
      selectField("category");

      const options = group(CATEGORY_LABEL);
      expect(within(options).getByText(CHANGE_TO_HEADING)).toBeInTheDocument();
      expect(
        within(options).queryByText(CATEGORY_LABEL),
      ).not.toBeInTheDocument();
    });

    it("excludes the current value from the options row", () => {
      renderDialog({ categorySlug: "crafts" });
      openDialog();
      selectField("category");

      expect(screen.getAllByText("工藝文創")).toHaveLength(1);
      expect(
        within(group(CATEGORY_LABEL)).queryByRole("button", {
          name: "工藝文創",
        }),
      ).not.toBeInTheDocument();
    });

    it("renders one option chip per remaining category", () => {
      renderDialog({ categorySlug: "crafts" });
      openDialog();
      selectField("category");

      expect(within(group(CATEGORY_LABEL)).getAllByRole("button")).toHaveLength(
        L1_CATEGORIES.length - 1,
      );
    });

    it("renders a placeholder in row 1 when the field is unset", () => {
      renderDialog({ categorySlug: null });
      openDialog();
      selectField("category");

      expect(
        within(group(CURRENT_HEADING)).getByText(PLACEHOLDER_COPY),
      ).toBeInTheDocument();
      expect(within(group(CATEGORY_LABEL)).getAllByRole("button")).toHaveLength(
        L1_CATEGORIES.length,
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

      selectField("category");
      expect(group(CATEGORY_LABEL)).toBeInTheDocument();

      selectField("price_range");
      expect(
        screen.queryByRole("group", { name: CATEGORY_LABEL }),
      ).not.toBeInTheDocument();
      expect(group(PRICE_RANGE_LABEL)).toBeInTheDocument();
    });

    it("omits subcategories from the field picker when the brand has no category", () => {
      renderDialog({ categorySlug: null });
      openDialog();

      const options = within(fieldPicker()).getAllByRole("option");
      expect(
        options.map((option) => (option as HTMLOptionElement).value),
      ).toEqual(["", "category", "price_range"]);
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
      renderSubcategories(["寢具", "家具"]);
      openSubcategoriesDialog();

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
      expect(mocks.toastSuccess).toHaveBeenCalledWith(COPY.success);
      await waitFor(() => {
        expect(screen.queryAllByRole("group")).toHaveLength(0);
      });
    });

    it("submits an add/remove delta, not a full set", async () => {
      renderSubcategories(["寢具", "家具"]);
      openSubcategoriesDialog();

      clickChip(ADD_TAGS_HEADING, "床墊");
      clickChip(CURRENT_TAGS_HEADING, "家具");
      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith({
          brandId: BRAND_ID,
          field: "subcategories",
          proposedValue: { add: ["床墊"], remove: ["家具"] },
        });
      });
    });

    it("uses canonical nameZh in both delta arrays", async () => {
      renderSubcategories(["寢具"]);
      openSubcategoriesDialog();

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
      renderSubcategories(["寢具", "家具"]);
      openSubcategoriesDialog();

      clickChip(ADD_TAGS_HEADING, "床墊");
      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith({
          brandId: BRAND_ID,
          field: "subcategories",
          proposedValue: { add: ["床墊"], remove: [] },
        });
      });
    });

    it("emits a remove-only delta", async () => {
      renderSubcategories(["寢具", "上衣・T恤"]);
      openSubcategoriesDialog();

      clickChip(CURRENT_TAGS_HEADING, "上衣・T恤");
      expect(screen.getByText(selectedCount(1))).toBeInTheDocument();

      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith({
          brandId: BRAND_ID,
          field: "subcategories",
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
        expect(mocks.toastError).toHaveBeenCalledWith(COPY.errors.rate_limited);
      });
    });
  });

  describe("tag rows", () => {
    // A `home` brand can still carry `fashion` tags: normalizeSubcategories keeps
    // cross-branch tags, and approving a category correction moves the
    // category without re-deriving subcategories. Those tags consume the 5-tag
    // cap, so they have to stay visible and removable.
    it("renders every current tag in row 1, including out-of-category ones", () => {
      renderSubcategories(["寢具", "上衣・T恤"]);
      openSubcategoriesDialog();

      const current = group(CURRENT_TAGS_HEADING);
      expect(
        within(current).getByRole("button", { name: "寢具" }),
      ).toBeEnabled();
      const offCategory = within(current).getByRole("button", {
        name: "上衣・T恤",
      });
      expect(offCategory).toBeEnabled();
      expect(offCategory).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(selectedCount(2))).toBeInTheDocument();
    });

    it("row 1 tags start pressed and flip to unpressed when marked for removal", () => {
      renderSubcategories(["寢具"]);
      openSubcategoriesDialog();

      expect(chip(CURRENT_TAGS_HEADING, "寢具")).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      clickChip(CURRENT_TAGS_HEADING, "寢具");

      expect(chip(CURRENT_TAGS_HEADING, "寢具")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByText(selectedCount(0))).toBeInTheDocument();
    });

    it("row 2 excludes tags already held", () => {
      renderSubcategories(["寢具"]);
      openSubcategoriesDialog();

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
      renderSubcategories(["上衣・T恤", "褲裝", "裙裝", "洋裝"]);
      openSubcategoriesDialog();

      expect(screen.getByText(selectedCount(4))).toBeInTheDocument();

      expandOther();
      typeOther("藤編椅");
      confirmOther();

      expect(screen.getByText(selectedCount(5))).toBeInTheDocument();
      expect(screen.getByText(COPY.subcategoriesLimit)).toBeInTheDocument();
      expect(chip(ADD_TAGS_HEADING, "寢具")).toBeDisabled();
    });

    it("disables unselected row-2 chips at the cap while pressed ones stay enabled", () => {
      const currentTags = homeTagsAt(5);
      renderSubcategories(currentTags);
      openSubcategoriesDialog();

      expect(screen.getByText(selectedCount(5))).toBeInTheDocument();

      const options = within(group(ADD_TAGS_HEADING)).getAllByRole("button");
      expect(options.length).toBeGreaterThan(0);
      expect(options.every((button) => button.hasAttribute("disabled"))).toBe(
        true,
      );

      for (const tag of currentTags) {
        expect(chip(CURRENT_TAGS_HEADING, tag)).toBeEnabled();
      }
    });

    // Restoring a tag that was marked for removal is an add, and adds no-op at
    // the cap. Without the guard the chip would look live and do nothing.
    it("disables a removed row-1 tag once the cap is refilled elsewhere", () => {
      const currentTags = homeTagsAt(5);
      const [removed] = currentTags;
      const replacement = HOME_SUBCATEGORIES[5]?.nameZh;
      expect(removed).toBeDefined();
      expect(replacement).toBeDefined();
      if (!removed || !replacement) return;

      renderSubcategories(currentTags);
      openSubcategoriesDialog();

      clickChip(CURRENT_TAGS_HEADING, removed);
      expect(screen.getByText(selectedCount(4))).toBeInTheDocument();
      expect(chip(CURRENT_TAGS_HEADING, removed)).toBeEnabled();

      clickChip(ADD_TAGS_HEADING, replacement);
      expect(screen.getByText(selectedCount(5))).toBeInTheDocument();
      expect(chip(CURRENT_TAGS_HEADING, removed)).toBeDisabled();
      expect(chip(CURRENT_TAGS_HEADING, removed)).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("counts a duplicated legacy tag once", () => {
      renderSubcategories(["寢具", "寢具"]);
      openSubcategoriesDialog();

      expect(
        within(group(CURRENT_TAGS_HEADING)).getAllByRole("button", {
          name: "寢具",
        }),
      ).toHaveLength(1);
      expect(screen.getByText(selectedCount(1))).toBeInTheDocument();
    });

    it("resets the selection after a successful submit", async () => {
      renderSubcategories(["寢具"]);
      openSubcategoriesDialog();

      clickChip(ADD_TAGS_HEADING, "床墊");
      submit();

      await waitFor(() => {
        expect(screen.queryAllByRole("group")).toHaveLength(0);
      });

      openSubcategoriesDialog();

      expect(chip(CURRENT_TAGS_HEADING, "寢具")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(chip(ADD_TAGS_HEADING, "床墊")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByText(selectedCount(1))).toBeInTheDocument();
      expect(submitButton()).toBeDisabled();
    });
  });

  describe("other tag flow", () => {
    it("canonicalizes an alias to its nameZh instead of adding the typed string", () => {
      renderSubcategories([]);
      openSubcategoriesDialog();

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
      renderSubcategories([]);
      openSubcategoriesDialog();

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
      renderSubcategories([]);
      openSubcategoriesDialog();

      expandOther();
      typeOther("洋裝");
      confirmOther();

      expect(chip(ADD_TAGS_HEADING, "洋裝")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByText(selectedCount(1))).toBeInTheDocument();
    });

    it("appends an accepted novel tag as a selected chip", async () => {
      renderSubcategories([]);
      openSubcategoriesDialog();

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
          field: "subcategories",
          proposedValue: { add: ["藤編椅"], remove: [] },
        });
      });
    });

    it("shows an inline reason for a blocklisted entry and does not add it", () => {
      renderSubcategories([]);
      openSubcategoriesDialog();

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
      expect(text).toContain(COPY.errors.subcategoryBlocked);
      expect(
        within(group(ADD_TAGS_HEADING)).queryByRole("button", {
          name: "限定",
        }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(selectedCount(0))).toBeInTheDocument();
    });

    it("shows an inline reason for a too-short entry and does not add it", () => {
      renderSubcategories([]);
      openSubcategoriesDialog();

      expandOther();
      typeOther("杯");
      confirmOther();

      expect(screen.getByLabelText(OTHER_INPUT_LABEL)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.getByText(COPY.errors.subcategoryLength)).toBeInTheDocument();
      expect(screen.getByText(selectedCount(0))).toBeInTheDocument();
    });

    it("reports a duplicate when the typed value is already in row 1", () => {
      renderSubcategories(["寢具"]);
      openSubcategoriesDialog();

      expandOther();
      typeOther("床包");
      confirmOther();

      expect(screen.getByText(COPY.otherSubcategoryDuplicate)).toBeInTheDocument();
      expect(screen.getByText(selectedCount(1))).toBeInTheDocument();
      expect(
        within(group(CURRENT_TAGS_HEADING)).getAllByRole("button", {
          name: "寢具",
        }),
      ).toHaveLength(1);
    });

    it("disables the 其他 affordance at the 5-tag cap", () => {
      renderSubcategories(homeTagsAt(5));
      openSubcategoriesDialog();

      expect(chip(ADD_TAGS_HEADING, OTHER_CHIP)).toBeDisabled();
      expect(
        screen.queryByLabelText(OTHER_INPUT_LABEL),
      ).not.toBeInTheDocument();
    });

    // Stored tags are not guaranteed canonical — the owner edit path persists
    // whatever alias was typed — so the duplicate check has to compare on a
    // canonical basis or the same subcategory lands twice.
    it("reports a duplicate when the brand carries an alias of the typed tag", () => {
      renderSubcategories(["床包"]);
      openSubcategoriesDialog();

      expandOther();
      typeOther("寢具");
      confirmOther();

      expect(screen.getByText(COPY.otherSubcategoryDuplicate)).toBeInTheDocument();
      expect(screen.getByText(selectedCount(1))).toBeInTheDocument();
      expect(
        within(group(ADD_TAGS_HEADING)).queryByRole("button", {
          name: "寢具",
        }),
      ).not.toBeInTheDocument();
    });

    // Disabling the 其他 chip does not unmount an entry panel opened below the
    // cap, so the cap has to be stated inside the panel too.
    it("keeps the entry open and explains the cap instead of dropping the tag", () => {
      const replacement = HOME_SUBCATEGORIES[4]?.nameZh;
      expect(replacement).toBeDefined();
      if (!replacement) return;

      renderSubcategories(homeTagsAt(4));
      openSubcategoriesDialog();

      expandOther();
      // The cap is reached while the entry panel is already open.
      clickChip(ADD_TAGS_HEADING, replacement);
      expect(screen.getByText(selectedCount(5))).toBeInTheDocument();

      typeOther("藤編椅");
      confirmOther();

      const input = screen.getByLabelText(OTHER_INPUT_LABEL);
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(screen.getAllByText(COPY.subcategoriesLimit).length).toBeGreaterThan(
        0,
      );
      expect(screen.getByText(selectedCount(5))).toBeInTheDocument();
      expect(
        within(group(ADD_TAGS_HEADING)).queryByRole("button", {
          name: "藤編椅",
        }),
      ).not.toBeInTheDocument();
    });

    // The 其他 chip is disabled at the cap, and focusing an element that is
    // about to be disabled drops focus to <body> mid-dialog.
    it("keeps focus inside the dialog after the confirmed tag fills the cap", () => {
      renderSubcategories(homeTagsAt(4));
      openSubcategoriesDialog();

      expandOther();
      typeOther("藤編椅");
      confirmOther();

      expect(screen.getByText(selectedCount(5))).toBeInTheDocument();
      expect(chip(ADD_TAGS_HEADING, OTHER_CHIP)).toBeDisabled();

      const dialog = screen.getByRole("dialog");
      expect(document.activeElement).not.toBe(document.body);
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it("returns focus to the 其他 chip when the entry is cancelled", () => {
      renderSubcategories([]);
      openSubcategoriesDialog();

      expandOther();
      expect(screen.getByLabelText(OTHER_INPUT_LABEL)).toHaveFocus();

      clickChip(ADD_TAGS_HEADING, OTHER_CANCEL);

      expect(
        screen.queryByLabelText(OTHER_INPUT_LABEL),
      ).not.toBeInTheDocument();
      expect(chip(ADD_TAGS_HEADING, OTHER_CHIP)).toHaveFocus();
    });
  });

  // The submission flow strips the query string off a pasted link; the queue
  // only ever sees the cleaned form from either entry point.
  describe("link cleaning", () => {
    function openLinkField() {
      fireEvent.click(
        screen.getByRole("button", { name: COPY.purchaseTrigger }),
      );
      fireEvent.change(
        screen.getByRole("combobox", { name: COPY.purchaseFieldPickerLabel }),
        { target: { value: "purchase_shopee" } },
      );
      return screen.getByLabelText(COPY.purchaseUrlLabel);
    }

    it("strips the query string from a pasted link on blur", () => {
      renderDialog({ mode: "purchaseLinks" });
      const input = openLinkField();

      fireEvent.change(input, {
        target: { value: "https://shopee.tw/warmwood?utm_source=ig" },
      });
      fireEvent.blur(input);

      expect(input).toHaveValue("https://shopee.tw/warmwood");
    });

    it("submits the cleaned URL", async () => {
      renderDialog({ mode: "purchaseLinks" });
      const input = openLinkField();

      fireEvent.change(input, {
        target: { value: "https://shopee.tw/warmwood?utm_source=ig" },
      });
      fireEvent.blur(input);
      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith({
          brandId: BRAND_ID,
          field: "purchase_shopee",
          proposedValue: "https://shopee.tw/warmwood",
        });
      });
    });

    it("leaves a query-only value alone so validation can reject it", () => {
      renderDialog({ mode: "purchaseLinks" });
      const input = openLinkField();

      fireEvent.change(input, { target: { value: "?utm_source=ig" } });
      fireEvent.blur(input);

      expect(input).toHaveValue("?utm_source=ig");
    });
  });
});
