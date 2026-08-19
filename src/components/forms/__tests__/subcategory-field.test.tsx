// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SubcategoryField } from "../subcategory-field";

const LABELS = {
  search: "Product subcategories",
  searchHint: "Type to filter, then pick a chip.",
  selected: "Selected (tap to remove)",
  options: "Subcategories you can add",
  limit: "Up to 5 subcategories.",
  rejected: "That term is not in the list — pick the closest chip below.",
  empty: "No subcategory matches that filter.",
};

function renderField(initialSubcategories: string[] = [], suggestions: string[] = []) {
  return render(
    <SubcategoryField
      initialSubcategories={initialSubcategories}
      suggestions={suggestions}
      labels={LABELS}
    />,
  );
}

function hiddenValue(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('input[name="subcategories"]')
    ?.value;
}

describe("SubcategoryField", () => {
  it("carries stored slugs in the hidden input while the chips show labels", () => {
    const { container } = renderField(["backpacks"]);

    // The hidden input is transport — it must stay the stored slug.
    expect(hiddenValue(container)).toBe("backpacks");
    // The chip beside it is display — it must never show the slug.
    const selected = screen.getByRole("group", { name: LABELS.selected });
    expect(within(selected).getByRole("button", { name: /後背包/ })).toBeInTheDocument();
    expect(within(selected).queryByText("backpacks")).not.toBeInTheDocument();
  });

  it("adds a picked node as a slug", () => {
    const { container } = renderField();

    const options = screen.getByRole("group", { name: LABELS.options });
    fireEvent.click(within(options).getByRole("button", { name: "托特包" }));

    expect(hiddenValue(container)).toBe("tote-bags");
  });

  it("cannot commit free text", () => {
    const { container } = renderField();
    const field = screen.getByLabelText(LABELS.search);

    fireEvent.change(field, { target: { value: "手工燈籠" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(hiddenValue(container)).toBe("");
    expect(screen.getByText(LABELS.rejected)).toBeInTheDocument();
  });

  it("floats the directory's popular subcategories to the top of their group", () => {
    renderField([], ["托特包"]);
    const options = screen.getByRole("group", { name: LABELS.options });
    const bagsChips = within(options).getAllByRole("button");

    // Every node is still offered — the suggestion only reorders.
    expect(bagsChips.length).toBeGreaterThan(100);
    const toteIndex = bagsChips.findIndex((chip) => chip.textContent === "托特包");
    const backpackIndex = bagsChips.findIndex(
      (chip) => chip.textContent === "後背包",
    );
    expect(toteIndex).toBeGreaterThanOrEqual(0);
    expect(toteIndex).toBeLessThan(backpackIndex);
  });
});
