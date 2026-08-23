// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ChipRow,
  TOGGLE_CHIP_GAP_PX,
  ToggleChip,
  taxonomyLinkClasses,
} from "@/components/ui/toggle-chip";
import { cn } from "@/lib/utils";

describe("ToggleChip", () => {
  it("renders a native button with aria-pressed reflecting the pressed prop", () => {
    const { rerender } = render(
      <ToggleChip pressed={false} onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const chip = screen.getByRole("button", { name: "Ceramics" });
    expect(chip.tagName).toBe("BUTTON");
    expect(chip).toHaveAttribute("type", "button");
    expect(chip).toHaveAttribute("aria-pressed", "false");

    rerender(
      <ToggleChip pressed onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    expect(screen.getByRole("button", { name: "Ceramics" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("calls onPressedChange with the negated state on click", () => {
    const onPressedChange = vi.fn();

    const { rerender } = render(
      <ToggleChip pressed={false} onPressedChange={onPressedChange}>
        Ceramics
      </ToggleChip>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ceramics" }));
    expect(onPressedChange).toHaveBeenLastCalledWith(true);

    rerender(
      <ToggleChip pressed onPressedChange={onPressedChange}>
        Ceramics
      </ToggleChip>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ceramics" }));
    expect(onPressedChange).toHaveBeenLastCalledWith(false);
    expect(onPressedChange).toHaveBeenCalledTimes(2);
  });

  it("applies the selected treatment only when pressed", () => {
    const { rerender } = render(
      <ToggleChip pressed onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const pressedChip = screen.getByRole("button", { name: "Ceramics" });
    expect(pressedChip).toHaveClass("border-accent");
    expect(pressedChip).toHaveClass("bg-accent");
    expect(pressedChip).toHaveClass("text-ground");

    rerender(
      <ToggleChip pressed={false} onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const unpressedChip = screen.getByRole("button", { name: "Ceramics" });
    expect(unpressedChip).not.toHaveClass("border-accent");
    expect(unpressedChip).not.toHaveClass("bg-accent");
    expect(unpressedChip).not.toHaveClass("text-ground");
  });

  // The Button `secondary` variant carries a hover fill. Without hover-scope
  // overrides twMerge keeps both and the hover rule wins the cascade, so a
  // selected chip would look unselected under the cursor while aria-pressed
  // stayed true.
  it("keeps the selected fill at hover scope", () => {
    render(
      <ToggleChip pressed onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const chip = screen.getByRole("button", { name: "Ceramics" });
    expect(chip).toHaveClass("hover:border-accent");
    expect(chip).toHaveClass("hover:bg-accent");
    expect(chip).toHaveClass("hover:text-ground");
    expect(chip).not.toHaveClass("hover:bg-surface");
    expect(chip).not.toHaveClass("hover:text-ink");
  });

  it("keeps the reference treatment at hover scope", () => {
    const { rerender } = render(
      <ToggleChip pressed tone="reference" onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const keptChip = screen.getByRole("button", { name: "Ceramics" });
    // The point is that hover EQUALS rest — a reference chip must not repaint
    // under the cursor. Asserting the pair directly says that; the old
    // `not.toHaveClass(<Button's hover token>)` said it only for as long as
    // that token differed from the chip's own fill.
    expect(keptChip).toHaveClass("bg-surface");
    expect(keptChip).toHaveClass("hover:bg-surface");
    expect(keptChip).not.toHaveClass("hover:bg-accent");

    rerender(
      <ToggleChip pressed={false} tone="reference" onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const struckChip = screen.getByRole("button", { name: "Ceramics" });
    expect(struckChip).toHaveClass("bg-surface");
    expect(struckChip).toHaveClass("hover:bg-surface");
    expect(struckChip).toHaveClass("text-ink-muted");
    expect(struckChip).toHaveClass("hover:text-ink-muted");
    expect(struckChip).not.toHaveClass("hover:bg-accent");
  });

  it("reference tone never uses the primary fill", () => {
    const { rerender } = render(
      <ToggleChip pressed tone="reference" onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const keptChip = screen.getByRole("button", { name: "Ceramics" });
    expect(keptChip).toHaveClass("bg-surface");
    expect(keptChip).not.toHaveClass("bg-accent");
    expect(keptChip).not.toHaveClass("border-accent");
    expect(keptChip).not.toHaveClass("text-ground");
    expect(keptChip).not.toHaveClass("line-through");

    rerender(
      <ToggleChip pressed={false} tone="reference" onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const struckChip = screen.getByRole("button", { name: "Ceramics" });
    expect(struckChip).toHaveClass("bg-surface");
    expect(struckChip).not.toHaveClass("bg-accent");
    expect(struckChip).not.toHaveClass("border-accent");
    expect(struckChip).not.toHaveClass("text-ground");
    expect(struckChip).toHaveClass("line-through");
    expect(struckChip).toHaveClass("text-ink-muted");
  });

  it("does not fire onPressedChange when disabled", () => {
    const onPressedChange = vi.fn();

    render(
      <ToggleChip pressed={false} disabled onPressedChange={onPressedChange}>
        Ceramics
      </ToggleChip>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ceramics" }));
    expect(onPressedChange).not.toHaveBeenCalled();
  });

  it("forwards className and size through to the underlying Button", () => {
    render(
      <ToggleChip
        pressed={false}
        onPressedChange={vi.fn()}
        size="chip"
        className="active:animate-spring-pop"
      >
        Ceramics
      </ToggleChip>,
    );

    const chip = screen.getByRole("button", { name: "Ceramics" });
    expect(chip).toHaveClass("active:animate-spring-pop");
    // size="chip" maps to the Button size variant's 36px track
    expect(chip).toHaveClass("h-9");
    expect(chip).not.toHaveClass("h-8");
  });

  // 36px is the ONE documented exception to the 44x44 touch minimum, and it
  // only holds while neighbouring chips sit >=14px apart. A chip that can be
  // rendered flush against its neighbour would void the exception, so the gap
  // is part of the chip's own contract rather than the caller's discipline.
  it("meets the 36px chip height without a caller opting in", () => {
    render(
      <ToggleChip pressed={false} onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const chip = screen.getByRole("button", { name: "Ceramics" });
    expect(chip).toHaveClass("h-9");
    expect(chip).not.toHaveClass("h-11");
  });

  it("carries no margin of its own, because the row owns the gap", () => {
    render(
      <ToggleChip pressed={false} onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    // The chip used to carry `m-[7px]` on all four sides. A margin is the one
    // spacing mechanism a parent cannot see: rows kept their own `gap-2` on
    // top of it (real gap 22px, not 14px) and every row sat 7px right of the
    // heading above it. `gap` measures between margin boxes, so the row's
    // 14px is only 14px while this stays empty.
    expect(screen.getByRole("button", { name: "Ceramics" }).className).not.toMatch(
      /(^|\s)-?m-\[/,
    );
  });

  it("gives the link-shaped chip the same height and spacing contract", () => {
    const classes = taxonomyLinkClasses();

    expect(classes).toContain("h-9");
    expect(classes).not.toMatch(/(^|\s)-?m-\[/);
    expect(classes).toContain("rounded-full");
  });

  it("gives the unpressed chip a rule outline, never an ink one", () => {
    render(
      <ToggleChip pressed={false} onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const chip = screen.getByRole("button", { name: "Ceramics" });
    expect(chip).toHaveClass("border-rule");
    expect(chip).not.toHaveClass("border-ink");
  });
});

describe("ChipRow", () => {
  it("holds chips exactly TOGGLE_CHIP_GAP_PX apart", () => {
    expect(TOGGLE_CHIP_GAP_PX).toBe(14);

    render(
      <ChipRow data-testid="row">
        <ToggleChip pressed={false} onPressedChange={vi.fn()}>
          Ceramics
        </ToggleChip>
      </ChipRow>,
    );

    const row = screen.getByTestId("row");
    expect(row).toHaveClass("flex", "flex-wrap", `gap-[${TOGGLE_CHIP_GAP_PX}px]`);
  });

  it("keeps a caller's own margin instead of eating it", () => {
    // THE REGRESSION THIS FILE MISSED. `city-card.tsx` wrote
    // `cn("mt-3", rowClasses)` against the old `-m-[7px] flex flex-wrap` row,
    // and tailwind-merge reads `-m-*` as covering `mt-*` — so `mt-3` was
    // dropped and the district chips butted against the count line above
    // them. Asserting the constant contained `-m-[7px]` could never see that;
    // only composing the row the way a caller composes it can.
    render(<ChipRow className="mt-3" data-testid="row" />);

    expect(screen.getByTestId("row")).toHaveClass("mt-3");

    // And the same check one level down, on `cn` itself, so the failure is
    // legible as "the merge ate it" rather than "the class is missing".
    expect(cn("mt-3", "flex flex-wrap gap-[14px]")).toContain("mt-3");
  });

  it("renders a ul when the chips are list items", () => {
    render(
      <ChipRow as="ul" aria-label="Districts">
        <li>{"Da'an"}</li>
      </ChipRow>,
    );

    expect(screen.getByRole("list", { name: "Districts" }).tagName).toBe("UL");
  });

  it("lets a caller change the flow without touching the gap", () => {
    // The newsletter row scrolls rather than wraps. It must still be 14px.
    render(<ChipRow className="flex-nowrap overflow-x-auto" data-testid="row" />);

    const row = screen.getByTestId("row");
    expect(row).toHaveClass("flex-nowrap", "gap-[14px]");
    expect(row).not.toHaveClass("flex-wrap");
  });
});
