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
  subcategoryDisplayLabel,
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
const CURRENT_SUBCATEGORIES_HEADING = COPY.currentSubcategoriesHeading;
const ADD_SUBCATEGORIES_HEADING = COPY.addSubcategoriesHeading;
const PLACEHOLDER_COPY = COPY.selectPlaceholder;
const SUBCATEGORY_SEARCH_LABEL = COPY.subcategorySearchLabel;
const SUBCATEGORY_REJECTED = COPY.subcategoryRejected;

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
        categorySlug="home"
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

function openCategoryDialog(categorySlug: string | null = "home") {
  renderDialog({ categorySlug });
  openDialog();
  selectField("category");
}

const HOME_SUBCATEGORIES = L2_SUBCATEGORIES.filter(
  (subcategory) => subcategory.category === "home",
);

/** Stored values are slugs since DEV-1510; the chips render their labels. */
function homeSubcategoriesAt(count: number) {
  return HOME_SUBCATEGORIES.slice(0, count).map(
    (subcategory) => subcategory.slug,
  );
}

function label(slug: string) {
  return subcategoryDisplayLabel(slug, "zh-TW");
}

function searchField() {
  return screen.getByLabelText(SUBCATEGORY_SEARCH_LABEL);
}

function typeAndCommit(value: string) {
  fireEvent.change(searchField(), { target: { value } });
  fireEvent.keyDown(searchField(), { key: "Enter" });
}

describe("CorrectionDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitCorrection.mockResolvedValue({ ok: true, id: "correction-1" });
  });

  describe("structure", () => {
    it("renders the current category as a non-interactive reference, not a button", () => {
      openCategoryDialog();

      const current = group(CURRENT_HEADING);
      expect(within(current).getByText("居家生活")).toBeInTheDocument();
      expect(within(current).queryAllByRole("button")).toHaveLength(0);
    });

    // The dialog reads as a diff: 目前 / 改成. The field label stays the group's
    // accessible name so the row is still addressable as 類別 / 價格區間.
    it("heads the options row with the change-to heading while keeping the field label as its name", () => {
      openCategoryDialog();

      const options = group(CATEGORY_LABEL);
      expect(within(options).getByText(CHANGE_TO_HEADING)).toBeInTheDocument();
      expect(
        within(options).queryByText(CATEGORY_LABEL),
      ).not.toBeInTheDocument();
    });

    it("excludes the current value from the options row", () => {
      openCategoryDialog();

      expect(screen.getAllByText("居家生活")).toHaveLength(1);
      expect(
        within(group(CATEGORY_LABEL)).queryByRole("button", {
          name: "居家生活",
        }),
      ).not.toBeInTheDocument();
    });

    // One chip per category the brand is not already in — so an unset brand is
    // offered the whole list, and a set one is offered the list minus itself.
    it.each([
      ["a brand with a category", "home", L1_CATEGORIES.length - 1],
      ["a brand with none", null, L1_CATEGORIES.length],
    ] as const)(
      "renders one option chip per selectable category for %s",
      (_label, categorySlug, expected) => {
        openCategoryDialog(categorySlug);

        expect(
          within(group(CATEGORY_LABEL)).getAllByRole("button"),
        ).toHaveLength(expected);
      },
    );

    it("renders a placeholder in row 1 when the field is unset", () => {
      openCategoryDialog(null);

      expect(
        within(group(CURRENT_HEADING)).getByText(PLACEHOLDER_COPY),
      ).toBeInTheDocument();
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

    it("submit stays disabled while the subcategory set is unchanged", () => {
      renderSubcategories(["bedding", "furniture"]);
      openSubcategoriesDialog();

      expect(submitButton()).toBeDisabled();

      clickChip(ADD_SUBCATEGORIES_HEADING, label("mattresses"));
      expect(submitButton()).toBeEnabled();

      // A picked node moves into the selected row, which is where it is
      // deselected from — hunting for one pressed chip among the whole L2
      // vocabulary is worse.
      clickChip(CURRENT_SUBCATEGORIES_HEADING, label("mattresses"));
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
      renderSubcategories(["bedding", "furniture"]);
      openSubcategoriesDialog();

      clickChip(ADD_SUBCATEGORIES_HEADING, label("mattresses"));
      clickChip(CURRENT_SUBCATEGORIES_HEADING, label("furniture"));
      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith({
          brandId: BRAND_ID,
          field: "subcategories",
          proposedValue: { add: ["mattresses"], remove: ["furniture"] },
        });
      });
    });

    it("uses stored slugs in both delta arrays, never the rendered label", async () => {
      renderSubcategories(["bedding"]);
      openSubcategoriesDialog();

      clickChip(CURRENT_SUBCATEGORIES_HEADING, label("bedding"));
      clickChip(ADD_SUBCATEGORIES_HEADING, label("mattresses"));
      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith(
          expect.objectContaining({
            proposedValue: { add: ["mattresses"], remove: ["bedding"] },
          }),
        );
      });
      expect(mocks.submitCorrection).not.toHaveBeenCalledWith(
        expect.objectContaining({
          proposedValue: { add: ["床墊"], remove: ["寢具"] },
        }),
      );
    });

    it("omits untouched subcategories from the delta", async () => {
      renderSubcategories(["bedding", "furniture"]);
      openSubcategoriesDialog();

      clickChip(ADD_SUBCATEGORIES_HEADING, label("mattresses"));
      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith({
          brandId: BRAND_ID,
          field: "subcategories",
          proposedValue: { add: ["mattresses"], remove: [] },
        });
      });
    });

    it("emits a remove-only delta", async () => {
      renderSubcategories(["bedding", "tops-and-tshirts"]);
      openSubcategoriesDialog();

      clickChip(CURRENT_SUBCATEGORIES_HEADING, label("tops-and-tshirts"));
      expect(screen.getByText(selectedCount(1))).toBeInTheDocument();

      submit();

      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith({
          brandId: BRAND_ID,
          field: "subcategories",
          proposedValue: { add: [], remove: ["tops-and-tshirts"] },
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

  describe("subcategory rows", () => {
    // A `home` brand can carry `fashion` subcategories: one brand holds one L1
    // while its products span several, and DEV-1510 stopped discarding those
    // tags on the read side. They consume the 5-subcategory cap, so they have
    // to stay visible and removable.
    it("renders every current subcategory in row 1, including out-of-category ones", () => {
      renderSubcategories(["bedding", "tops-and-tshirts"]);
      openSubcategoriesDialog();

      const current = group(CURRENT_SUBCATEGORIES_HEADING);
      expect(
        within(current).getByRole("button", { name: label("bedding") }),
      ).toBeEnabled();
      const offCategory = within(current).getByRole("button", {
        name: label("tops-and-tshirts"),
      });
      expect(offCategory).toBeEnabled();
      expect(offCategory).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(selectedCount(2))).toBeInTheDocument();
    });

    it("renders stored slugs as zh labels, never as raw slugs", () => {
      renderSubcategories(["bedding"]);
      openSubcategoriesDialog();

      expect(screen.queryByText("bedding")).not.toBeInTheDocument();
      expect(
        within(group(CURRENT_SUBCATEGORIES_HEADING)).getByRole("button", {
          name: "寢具",
        }),
      ).toBeInTheDocument();
    });

    it("row 1 subcategories start pressed and flip to unpressed when marked for removal", () => {
      renderSubcategories(["bedding"]);
      openSubcategoriesDialog();

      expect(
        chip(CURRENT_SUBCATEGORIES_HEADING, label("bedding")),
      ).toHaveAttribute("aria-pressed", "true");

      clickChip(CURRENT_SUBCATEGORIES_HEADING, label("bedding"));

      expect(
        chip(CURRENT_SUBCATEGORIES_HEADING, label("bedding")),
      ).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByText(selectedCount(0))).toBeInTheDocument();
    });

    // The write-side counterpart of the cross-L1 read fix: a `home` brand can
    // be given `backpacks`, which the brand's own L1 would never have offered.
    it("offers every L2 node, not just the brand's own L1", () => {
      renderSubcategories(["bedding"]);
      openSubcategoriesDialog();

      const options = group(ADD_SUBCATEGORIES_HEADING);
      expect(within(options).getAllByRole("button")).toHaveLength(
        L2_SUBCATEGORIES.length - 1,
      );
      expect(
        within(options).queryByRole("button", { name: label("bedding") }),
      ).not.toBeInTheDocument();
      expect(
        within(options).getByRole("button", { name: label("backpacks") }),
      ).toBeInTheDocument();
    });

    it("counts out-of-category subcategories against the 5 cap", () => {
      renderSubcategories([
        "tops-and-tshirts",
        "pants",
        "skirts",
        "dresses",
      ]);
      openSubcategoriesDialog();

      expect(screen.getByText(selectedCount(4))).toBeInTheDocument();

      clickChip(ADD_SUBCATEGORIES_HEADING, label("bedding"));

      expect(screen.getByText(selectedCount(5))).toBeInTheDocument();
      expect(screen.getByText(COPY.subcategoriesLimit)).toBeInTheDocument();
      expect(chip(ADD_SUBCATEGORIES_HEADING, label("mattresses"))).toBeDisabled();
    });

    it("disables the whole offer set at the cap while selected chips stay enabled", () => {
      const currentSubcategories = homeSubcategoriesAt(5);
      renderSubcategories(currentSubcategories);
      openSubcategoriesDialog();

      expect(screen.getByText(selectedCount(5))).toBeInTheDocument();

      const options = within(group(ADD_SUBCATEGORIES_HEADING)).getAllByRole(
        "button",
      );
      expect(options.length).toBeGreaterThan(0);
      expect(options.every((button) => button.hasAttribute("disabled"))).toBe(
        true,
      );

      for (const slug of currentSubcategories) {
        expect(chip(CURRENT_SUBCATEGORIES_HEADING, label(slug))).toBeEnabled();
      }
    });

    // Restoring a subcategory marked for removal is an add, and adds no-op at
    // the cap. Without the guard the chip would look live and do nothing.
    it("disables a removed row-1 subcategory once the cap is refilled elsewhere", () => {
      const currentSubcategories = homeSubcategoriesAt(5);
      const [removed] = currentSubcategories;
      const replacement = HOME_SUBCATEGORIES[5]?.slug;
      expect(removed).toBeDefined();
      expect(replacement).toBeDefined();
      if (!removed || !replacement) return;

      renderSubcategories(currentSubcategories);
      openSubcategoriesDialog();

      clickChip(CURRENT_SUBCATEGORIES_HEADING, label(removed));
      expect(screen.getByText(selectedCount(4))).toBeInTheDocument();
      expect(chip(CURRENT_SUBCATEGORIES_HEADING, label(removed))).toBeEnabled();

      clickChip(ADD_SUBCATEGORIES_HEADING, label(replacement));
      expect(screen.getByText(selectedCount(5))).toBeInTheDocument();
      expect(chip(CURRENT_SUBCATEGORIES_HEADING, label(removed))).toBeDisabled();
      expect(
        chip(CURRENT_SUBCATEGORIES_HEADING, label(removed)),
      ).toHaveAttribute("aria-pressed", "false");
    });

    it("counts a duplicated legacy subcategory once", () => {
      renderSubcategories(["bedding", "bedding"]);
      openSubcategoriesDialog();

      expect(
        within(group(CURRENT_SUBCATEGORIES_HEADING)).getAllByRole("button", {
          name: label("bedding"),
        }),
      ).toHaveLength(1);
      expect(screen.getByText(selectedCount(1))).toBeInTheDocument();
    });

    it("resets the selection after a successful submit", async () => {
      renderSubcategories(["bedding"]);
      openSubcategoriesDialog();

      clickChip(ADD_SUBCATEGORIES_HEADING, label("mattresses"));
      submit();

      await waitFor(() => {
        expect(screen.queryAllByRole("group")).toHaveLength(0);
      });

      openSubcategoriesDialog();

      expect(
        chip(CURRENT_SUBCATEGORIES_HEADING, label("bedding")),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        chip(ADD_SUBCATEGORIES_HEADING, label("mattresses")),
      ).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByText(selectedCount(1))).toBeInTheDocument();
      expect(submitButton()).toBeDisabled();
    });
  });

  // The free-text escape hatch is gone. What replaced it is not silence: a term
  // the closed vocabulary does not know is announced to the person who typed it
  // and recorded for the people who own the vocabulary.
  describe("the closed vocabulary", () => {
    it("commits an alias to its stored slug", async () => {
      renderSubcategories([]);
      openSubcategoriesDialog();

      typeAndCommit("T恤");

      expect(
        chip(CURRENT_SUBCATEGORIES_HEADING, label("tops-and-tshirts")),
      ).toHaveAttribute("aria-pressed", "true");

      submit();
      await waitFor(() => {
        expect(mocks.submitCorrection).toHaveBeenCalledWith(
          expect.objectContaining({
            proposedValue: { add: ["tops-and-tshirts"], remove: [] },
          }),
        );
      });
    });

    it("refuses a term the vocabulary does not know and says how to fix it", () => {
      renderSubcategories([]);
      openSubcategoriesDialog();

      typeAndCommit("手工燈籠");

      expect(screen.getByText(SUBCATEGORY_REJECTED)).toBeInTheDocument();
      expect(searchField()).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText(selectedCount(0))).toBeInTheDocument();
      expect(submitButton()).toBeDisabled();
    });

    it("offers no free-text entry at all", () => {
      renderSubcategories([]);
      openSubcategoriesDialog();

      // One text field only — the filter — and it cannot commit free text.
      expect(screen.getAllByRole("textbox")).toHaveLength(1);
      expect(searchField()).toBeInTheDocument();
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
