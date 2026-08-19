// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CARD_GRID_COLUMNS, Grid, gridStyles } from "@/components/ui/grid";

describe("Grid", () => {
  it("renders the documented column counts per breakpoint", () => {
    render(<Grid data-testid="grid" />);

    const grid = screen.getByTestId("grid");

    // The formula six files spelled out by hand, now spelled once.
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("sm:grid-cols-2");
    expect(grid.className).toContain("lg:grid-cols-4");
    expect(CARD_GRID_COLUMNS).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-4");
  });

  it("accepts a gap token", () => {
    render(<Grid data-testid="grid" />);

    // `gap-gutter` resolves to `--space-gutter`. The six copies of this grid
    // carried four DIFFERENT ad-hoc numerics (gap-4, gap-5, gap-6, gap-x-5),
    // which is exactly the drift a token prevents.
    expect(screen.getByTestId("grid").className).toContain("gap-gutter");
    expect(screen.getByTestId("grid").className).not.toMatch(/\bgap-\d/);
  });

  it("offers no ad-hoc numeric gap", () => {
    // Every gap variant reads a token, never a raw step.
    for (const gap of ["gutter", "tight"] as const) {
      expect(gridStyles({ gap })).not.toMatch(/\bgap-\d/);
    }
  });

  it("exposes the other column formulas the app actually uses", () => {
    expect(gridStyles({ cols: "pair" })).toContain("md:grid-cols-2");
    expect(gridStyles({ cols: "triptych" })).toContain("md:grid-cols-3");
    expect(gridStyles({ cols: "thirds" })).toContain("lg:grid-cols-3");
  });

  it("renders a semantic element when asked", () => {
    render(
      <Grid as="ul" aria-label="Brands" data-testid="grid">
        <li>one</li>
      </Grid>,
    );

    const grid = screen.getByTestId("grid");
    expect(grid.tagName).toBe("UL");
    expect(grid).toHaveAttribute("aria-label", "Brands");
  });

  it("lets a caller add classes without losing the formula", () => {
    render(<Grid className="mt-8" data-testid="grid" />);

    const grid = screen.getByTestId("grid");
    expect(grid.className).toContain("mt-8");
    expect(grid.className).toContain("lg:grid-cols-4");
  });
});
