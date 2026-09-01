// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SubcategoryPicker } from "../subcategory-picker";
import {
  clearRejectedSubcategoryInputs,
  readRejectedSubcategoryInputs,
  setRejectedSubcategorySink,
} from "@/lib/services/subcategories";
import { L2_SUBCATEGORIES, VISIBLE_L1_CATEGORIES } from "@/lib/taxonomy/ontology";

const LABELS = {
  search: "Find a subcategory",
  searchHint: "Type to filter, then pick a chip.",
  selected: "Selected (click to remove)",
  options: "Add a subcategory",
  limit: "Up to 5 subcategories.",
  rejected: "That term is not in the list — pick the closest chip below.",
  empty: "No subcategory matches that filter.",
};

function renderPicker(
  props: Partial<React.ComponentProps<typeof SubcategoryPicker>> = {},
) {
  const onChange = vi.fn();
  const utils = render(
    <SubcategoryPicker
      value={[]}
      onChange={onChange}
      labels={LABELS}
      surface="test"
      locale="zh-TW"
      {...props}
    />,
  );
  return { ...utils, onChange };
}

/**
 * The picker is controlled, so a spy-only `onChange` never unmounts the chip
 * that was just activated — which is exactly the condition every focus
 * assertion below is about. This wrapper applies the change like a real caller.
 */
function ControlledPicker({
  initialValue = [],
  ...props
}: { initialValue?: string[] } & Partial<
  React.ComponentProps<typeof SubcategoryPicker>
>) {
  const [value, setValue] = useState<string[]>(initialValue);
  return (
    <SubcategoryPicker
      labels={LABELS}
      surface="test"
      locale="zh-TW"
      {...props}
      value={value}
      onChange={setValue}
    />
  );
}

function selectedGroup() {
  return screen.getByRole("group", { name: LABELS.selected });
}

function searchField() {
  return screen.getByLabelText(LABELS.search);
}

function optionsGroup() {
  return screen.getByRole("group", { name: LABELS.options });
}

function typeAndCommit(text: string) {
  fireEvent.change(searchField(), { target: { value: text } });
  fireEvent.keyDown(searchField(), { key: "Enter" });
}

describe("SubcategoryPicker", () => {
  beforeEach(() => {
    clearRejectedSubcategoryInputs();
    setRejectedSubcategorySink(null);
    vi.restoreAllMocks();
  });

  it("picker_offers_all_164_nodes_not_just_the_brands_l1", () => {
    // A `fashion` brand. Its own L1 is offered first, and every other L1 is
    // still offered below it — that is what makes a cross-L1 tag expressible
    // on the write side, and it is the counterpart of the cross-L1 read fix.
    const { onChange } = renderPicker({ priorityCategorySlug: "fashion" });

    const visibleL1Slugs = new Set(VISIBLE_L1_CATEGORIES.map(c => c.slug));
    const visibleL2Count = L2_SUBCATEGORIES.filter(s => visibleL1Slugs.has(s.category)).length;
    const options = within(optionsGroup()).getAllByRole("button");
    expect(options).toHaveLength(visibleL2Count);
    expect(visibleL2Count).toBe(105);

    // `backpacks` lives under `bags-accessories`, not under `fashion`.
    fireEvent.click(within(optionsGroup()).getByRole("button", { name: "後背包" }));
    expect(onChange).toHaveBeenCalledWith(["backpacks"]);
  });

  it("picker_rejects_free_text", () => {
    const { onChange } = renderPicker();

    // A real product kind with no node — the exact shape of a vocabulary gap.
    typeAndCommit("手工燈籠");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(LABELS.rejected)).toBeInTheDocument();
  });

  it("picker_logs_rejected_input", () => {
    const sink = vi.fn();
    setRejectedSubcategorySink(sink);
    renderPicker({ surface: "correction-dialog" });

    typeAndCommit("止滑墊");

    // The module log is the durable record; the sink is the surface's copy.
    expect(readRejectedSubcategoryInputs().map((entry) => entry.input)).toEqual([
      "止滑墊",
    ]);
    expect(readRejectedSubcategoryInputs()[0]?.surface).toBe("correction-dialog");
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("rejection_is_announced_accessibly", () => {
    renderPicker();

    expect(searchField()).not.toHaveAttribute("aria-invalid", "true");

    typeAndCommit("止滑墊");

    const field = searchField();
    expect(field).toHaveAttribute("aria-invalid", "true");
    const describedBy = field.getAttribute("aria-describedby") ?? "";
    const messageIds = describedBy.split(" ").filter(Boolean);
    const described = messageIds
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    // The message says how to FIX, and it is what aria-describedby points at.
    expect(described).toContain(LABELS.rejected);

    // Correcting the entry clears both the state and the announcement.
    fireEvent.change(field, { target: { value: "後背包" } });
    expect(searchField()).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(LABELS.rejected)).not.toBeInTheDocument();
  });

  it("commits a term the vocabulary knows on any basis — slug, label or alias", () => {
    const { onChange, rerender } = renderPicker();

    typeAndCommit("後背包");
    expect(onChange).toHaveBeenLastCalledWith(["backpacks"]);

    rerender(
      <SubcategoryPicker
        value={[]}
        onChange={onChange}
        labels={LABELS}
        surface="test"
        locale="zh-TW"
      />,
    );
    typeAndCommit("tote-bags");
    expect(onChange).toHaveBeenLastCalledWith(["tote-bags"]);

    rerender(
      <SubcategoryPicker
        value={[]}
        onChange={onChange}
        labels={LABELS}
        surface="test"
        locale="zh-TW"
      />,
    );
    typeAndCommit("T恤");
    expect(onChange).toHaveBeenLastCalledWith(["tops-and-tshirts"]);
  });

  it("commits a half-typed term that narrows to one node instead of logging a false gap", () => {
    const { onChange } = renderPicker();

    fireEvent.change(searchField(), { target: { value: "口金" } });
    expect(within(optionsGroup()).getAllByRole("button")).toHaveLength(1);

    fireEvent.keyDown(searchField(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["clasp-frame-bags"]);
    expect(readRejectedSubcategoryInputs()).toEqual([]);
  });

  it("renders stored slugs as localized labels, never as raw slugs", () => {
    renderPicker({ value: ["backpacks"] });
    const selected = screen.getByRole("group", { name: LABELS.selected });

    expect(within(selected).getByRole("button", { name: /後背包/ })).toBeInTheDocument();
    expect(within(selected).queryByText("backpacks")).not.toBeInTheDocument();
  });

  it("removes a selected chip and keeps a baseline value recoverable", () => {
    render(
      <ControlledPicker initialValue={["backpacks"]} baseline={["backpacks"]} />,
    );

    const chip = () =>
      within(selectedGroup()).getByRole("button", { name: /後背包/ });

    fireEvent.click(chip());
    // Removed: the chip stays in the selected row, unpressed, rather than
    // going back into the 175-item offer set.
    expect(chip()).toHaveAttribute("aria-pressed", "false");
    expect(
      within(optionsGroup()).queryByRole("button", { name: "後背包" }),
    ).not.toBeInTheDocument();

    // Recovered: pressing the same chip restores the value, which is the whole
    // point of keeping a baseline row.
    fireEvent.click(chip());
    expect(chip()).toHaveAttribute("aria-pressed", "true");
  });

  it("moves focus to the same node after a selection instead of dropping it to the body", () => {
    render(<ControlledPicker priorityCategorySlug="fashion" />);

    fireEvent.click(
      within(optionsGroup()).getByRole("button", { name: "後背包" }),
    );

    // The activated button unmounts — the offer set excludes what is already
    // selected — so without a deliberate move focus lands on <body> and a
    // keyboard user re-enters a 175-button list at position zero.
    const focused = document.activeElement as HTMLElement | null;
    expect(focused).not.toBe(document.body);
    expect(focused?.dataset.subcategoryChip).toBe("backpacks");
    expect(selectedGroup()).toContainElement(focused);
  });

  it("moves focus to the offer set after a deselection with no baseline", () => {
    // The wizard and the admin editor both pass no baseline, so a deselected
    // chip leaves the selected row entirely.
    render(<ControlledPicker initialValue={["backpacks"]} />);

    fireEvent.click(
      within(selectedGroup()).getByRole("button", { name: /後背包/ }),
    );

    const focused = document.activeElement as HTMLElement | null;
    expect(focused).not.toBe(document.body);
    expect(focused?.dataset.subcategoryChip).toBe("backpacks");
    expect(optionsGroup()).toContainElement(focused);
  });

  it("keeps focus in the filter field when a typed term commits", () => {
    // Focus movement is the strongest announcement, but stealing it out of a
    // text field the user is still typing in is not an announcement.
    render(<ControlledPicker />);

    const field = searchField();
    field.focus();
    fireEvent.change(field, { target: { value: "後背包" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(document.activeElement).toBe(searchField());
  });

  it("mounts both status regions before they have anything to say", () => {
    // A live region has to exist and be empty BEFORE its content changes, or
    // the announcement is routinely missed — including the at-limit case,
    // where all 175 option chips go disabled at once.
    render(<ControlledPicker />);

    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(2);
    for (const region of regions) expect(region).toBeEmptyDOMElement();

    // And the cap message is what describes the group it disables.
    const describedBy = optionsGroup().getAttribute("aria-describedby") ?? "";
    expect(regions.map((region) => region.id)).toContain(describedBy);
  });

  it("stops offering nodes at the cap and says why", () => {
    renderPicker({
      value: ["backpacks", "tote-bags", "crossbody-bags", "handbags"],
      max: 4,
    });

    expect(screen.getByText(LABELS.limit)).toBeInTheDocument();
    for (const option of within(optionsGroup()).getAllByRole("button")) {
      expect(option).toBeDisabled();
    }
  });

  it("says so when the filter matches nothing rather than rendering an empty rail", () => {
    renderPicker();
    fireEvent.change(searchField(), { target: { value: "zzzz" } });

    expect(screen.getByText(LABELS.empty)).toBeInTheDocument();
  });

  it("labels the filter field visibly and adds no competing aria-label", () => {
    renderPicker();
    const field = searchField();

    expect(field).not.toHaveAttribute("aria-label");
    expect(field).not.toHaveAttribute("placeholder");
    expect(document.querySelector(`label[for="${field.id}"]`)?.textContent).toBe(
      LABELS.search,
    );
  });
});
