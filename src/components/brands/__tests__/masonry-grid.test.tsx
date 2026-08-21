// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { gridStyles } from "@/components/ui/grid";
import { MASONRY_ABOVE_FOLD, MasonryGrid } from "../masonry-grid";

function cards(count: number) {
  return Array.from({ length: count }, (_, index) => (
    <span key={index}>card {index}</span>
  ));
}

/*
 * The directory grid is the shared grid, not a local formula that agrees with
 * it today.
 *
 * The four-up column formula was written out in six files with four different
 * gap values, and nothing made a card grid and its own loading skeleton agree.
 * The assertion below compares against `gridStyles()` — the primitive's own
 * output — rather than a class string, so it keeps holding when the column
 * count changes and fails the moment this surface stops asking the primitive.
 */
describe("MasonryGrid", () => {
  it("lays out on the shared grid primitive", () => {
    render(<MasonryGrid>{cards(2)}</MasonryGrid>);

    const grid = screen.getByRole("list");
    for (const className of gridStyles().split(" ")) {
      expect(grid).toHaveClass(className);
    }
  });

  it("uses the same primitive for the semantic list variant", () => {
    const { container } = render(<MasonryGrid compact>{cards(2)}</MasonryGrid>);

    const grid = container.querySelector("ul");
    expect(grid).not.toBeNull();
    for (const className of gridStyles().split(" ")) {
      expect(grid).toHaveClass(className);
    }
  });

  it("renders every capped card into the markup and hides the overflow", () => {
    // The cap is a CSS concern, never a slice: on the event lineup the hidden
    // cards are the crawlable substance of the page, and slicing would drop
    // them out of the server HTML entirely.
    const { container } = render(
      <MasonryGrid visibleCount={2}>{cards(5)}</MasonryGrid>,
    );

    expect(container.textContent).toContain("card 4");
    expect(container.querySelectorAll(".hidden")).toHaveLength(3);
  });

  it("renders the above-the-fold row visible on the server", () => {
    // Gating the LCP row behind the reveal observer keeps it at opacity 0 until
    // client JS hydrates, which is the LCP regression this constant exists for.
    const { container } = render(
      <MasonryGrid>{cards(MASONRY_ABOVE_FOLD + 1)}</MasonryGrid>,
    );

    const items = container.querySelectorAll('[role="listitem"]');
    for (const item of Array.from(items).slice(0, MASONRY_ABOVE_FOLD)) {
      expect(item.className).toBe("");
    }
  });
});
