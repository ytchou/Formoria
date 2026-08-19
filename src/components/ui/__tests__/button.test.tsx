// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  BUTTON_VARIANTS,
  Button,
  buttonVariants,
} from "@/components/ui/button";

/**
 * The three interaction variants v2 keeps. `destructive` is the danger
 * semantic, not an interaction colour, so it is asserted separately where the
 * rule genuinely applies to it (height, focus ring) and excluded where it does
 * not (the accent treatment).
 */
const INTERACTION_VARIANTS = ["primary", "secondary", "ghost"] as const;

describe("buttonVariants", () => {
  it("meets the 44px target across all three variants", () => {
    for (const variant of INTERACTION_VARIANTS) {
      // h-11 is 2.75rem — the 44x44 touch minimum.
      expect(buttonVariants({ variant })).toContain("h-11");
    }
  });

  it("meets the 44px target on every variant it still exposes", () => {
    for (const variant of BUTTON_VARIANTS) {
      expect(buttonVariants({ variant })).toContain("h-11");
    }
    // The icon-only size is a square of the same target.
    expect(buttonVariants({ size: "icon" })).toContain("size-11");
  });

  it("draws a 2px accent focus ring on every variant", () => {
    for (const variant of BUTTON_VARIANTS) {
      const classes = buttonVariants({ variant });

      expect(classes).toContain("focus-visible:ring-2");
      expect(classes).toContain("focus-visible:ring-accent");
      // `outline-none` is only legal because the ring above replaces it.
      expect(classes).toContain("outline-none");
    }
  });

  it("uses the 4px control radius by default and a pill only on request", () => {
    expect(buttonVariants()).toContain("rounded-[4px]");
    expect(buttonVariants({ shape: "pill" })).toContain("rounded-full");
    expect(buttonVariants()).not.toContain("rounded-xl");
  });

  it("no longer exposes overlay or tone:cta", () => {
    expect(BUTTON_VARIANTS).toEqual([
      "primary",
      "secondary",
      "ghost",
      "destructive",
    ]);
    expect(BUTTON_VARIANTS).not.toContain("overlay");

    // @ts-expect-error -- `overlay` was deleted with the second interaction colour.
    const overlay = buttonVariants({ variant: "overlay" });

    // An unknown variant name resolves to no variant styling at all, which is
    // how we know cva has forgotten the key rather than aliased it.
    expect(overlay).not.toContain("bg-accent");
    expect(overlay).not.toContain("backdrop-blur-sm");
    expect(buttonVariants({ variant: "primary" })).toContain("bg-accent");

    // @ts-expect-error -- the `tone` axis was deleted with `--cta`.
    const withTone = buttonVariants({ tone: "cta" });

    // `tone` is not read at all now, so passing it changes nothing.
    expect(withTone).toBe(buttonVariants());
  });

  it("keeps the accent for interaction only", () => {
    // secondary is an ink outline over a transparent fill; ghost is accent
    // TEXT. Neither may paint a large accent fill.
    expect(buttonVariants({ variant: "secondary" })).not.toContain("bg-accent");
    expect(buttonVariants({ variant: "ghost" })).not.toContain("bg-accent");
    expect(buttonVariants({ variant: "ghost" })).toContain("text-accent");
    expect(buttonVariants({ variant: "primary" })).toContain("text-ground");
  });

  it("carries no shadow — v2 elevation is borders", () => {
    for (const variant of BUTTON_VARIANTS) {
      expect(buttonVariants({ variant })).not.toMatch(/\bshadow-/);
    }
  });
});

describe("Button", () => {
  it("renders each variant as a real button at the 44px target", () => {
    for (const variant of INTERACTION_VARIANTS) {
      const { unmount } = render(<Button variant={variant}>Search</Button>);

      const button = screen.getByRole("button", { name: "Search" });
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveClass("h-11");

      unmount();
    }
  });

  it("keeps the 36px chip size as the documented exception", () => {
    render(
      <Button size="chip" variant="secondary">
        Ceramics
      </Button>,
    );

    // h-9 is 2.25rem — 36px, allowed only with >=14px between neighbours.
    expect(screen.getByRole("button", { name: "Ceramics" })).toHaveClass("h-9");
  });
});
