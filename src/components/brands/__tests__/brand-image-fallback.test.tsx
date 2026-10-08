/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandImageFallback } from "@/components/brands/brand-image-fallback";

describe("BrandImageFallback", () => {
  // DESIGN.md §2/§6b: the image placeholder is `--surface-deep`. DEV-1950
  // removed the per-category pastel that was painted inline, off-palette.
  it("paints the surface-deep token with no inline background", () => {
    render(<BrandImageFallback name="山間器物" category="home" size="card" />);
    const fallback = screen.getByTestId("image-fallback");

    expect(fallback).toHaveClass("bg-surface-deep");
    expect(fallback.style.backgroundColor).toBe("");
  });

  it("renders the first character of the name in muted ink", () => {
    render(<BrandImageFallback name="山間器物" size="detail" />);
    const initial = screen.getByText("山");

    expect(initial).toHaveClass("text-ink-muted");
    expect(screen.getByTestId("image-fallback")).toContainElement(initial);
  });
});
