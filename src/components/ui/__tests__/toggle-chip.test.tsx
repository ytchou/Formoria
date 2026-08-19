// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  TOGGLE_CHIP_GAP_PX,
  ToggleChip,
  taxonomyLinkClasses,
  toggleChipRowClasses,
} from "@/components/ui/toggle-chip";

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

  // The Button `secondary` variant hovers to bg-muted/text-foreground. Without
  // hover-scope overrides twMerge keeps both and the hover rule wins the
  // cascade, so a selected chip would look unselected under the cursor while
  // aria-pressed stayed true.
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
    expect(chip).not.toHaveClass("hover:bg-muted");
    expect(chip).not.toHaveClass("hover:text-foreground");
  });

  it("keeps the reference treatment at hover scope", () => {
    const { rerender } = render(
      <ToggleChip pressed tone="reference" onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const keptChip = screen.getByRole("button", { name: "Ceramics" });
    expect(keptChip).toHaveClass("hover:bg-secondary");
    expect(keptChip).not.toHaveClass("hover:bg-muted");
    expect(keptChip).not.toHaveClass("hover:bg-accent");

    rerender(
      <ToggleChip pressed={false} tone="reference" onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const struckChip = screen.getByRole("button", { name: "Ceramics" });
    expect(struckChip).toHaveClass("hover:bg-secondary");
    expect(struckChip).toHaveClass("hover:text-muted-foreground");
    expect(struckChip).not.toHaveClass("hover:bg-muted");
    expect(struckChip).not.toHaveClass("hover:text-foreground");
  });

  it("reference tone never uses the primary fill", () => {
    const { rerender } = render(
      <ToggleChip pressed tone="reference" onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const keptChip = screen.getByRole("button", { name: "Ceramics" });
    expect(keptChip).toHaveClass("bg-secondary");
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
    expect(struckChip).toHaveClass("bg-secondary");
    expect(struckChip).not.toHaveClass("bg-accent");
    expect(struckChip).not.toHaveClass("border-accent");
    expect(struckChip).not.toHaveClass("text-ground");
    expect(struckChip).toHaveClass("line-through");
    expect(struckChip).toHaveClass("text-muted-foreground");
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

  it("carries its own >=14px spacing so the 36px exception holds", () => {
    expect(TOGGLE_CHIP_GAP_PX).toBe(14);

    render(
      <ToggleChip pressed={false} onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    // Half the gap on every side: two flush chips still sit 14px apart, in
    // both axes, whatever the parent does.
    expect(screen.getByRole("button", { name: "Ceramics" })).toHaveClass(
      "m-[7px]",
    );

    // The row cancels only the OUTER half-gap, so the row still lines up flush
    // with the column around it while the inner gaps survive.
    expect(toggleChipRowClasses).toContain("-m-[7px]");
  });

  it("gives the link-shaped chip the same height and spacing contract", () => {
    const classes = taxonomyLinkClasses();

    expect(classes).toContain("h-9");
    expect(classes).toContain("m-[7px]");
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
