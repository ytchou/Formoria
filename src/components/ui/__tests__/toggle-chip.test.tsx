// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToggleChip } from "@/components/ui/toggle-chip";

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
    expect(pressedChip).toHaveClass("border-primary");
    expect(pressedChip).toHaveClass("bg-primary");
    expect(pressedChip).toHaveClass("text-primary-foreground");

    rerender(
      <ToggleChip pressed={false} onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const unpressedChip = screen.getByRole("button", { name: "Ceramics" });
    expect(unpressedChip).not.toHaveClass("border-primary");
    expect(unpressedChip).not.toHaveClass("bg-primary");
    expect(unpressedChip).not.toHaveClass("text-primary-foreground");
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
    expect(chip).toHaveClass("hover:border-primary");
    expect(chip).toHaveClass("hover:bg-primary");
    expect(chip).toHaveClass("hover:text-primary-foreground");
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
    expect(keptChip).not.toHaveClass("hover:bg-primary");

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
    expect(keptChip).not.toHaveClass("bg-primary");
    expect(keptChip).not.toHaveClass("border-primary");
    expect(keptChip).not.toHaveClass("text-primary-foreground");
    expect(keptChip).not.toHaveClass("line-through");

    rerender(
      <ToggleChip pressed={false} tone="reference" onPressedChange={vi.fn()}>
        Ceramics
      </ToggleChip>,
    );

    const struckChip = screen.getByRole("button", { name: "Ceramics" });
    expect(struckChip).toHaveClass("bg-secondary");
    expect(struckChip).not.toHaveClass("bg-primary");
    expect(struckChip).not.toHaveClass("border-primary");
    expect(struckChip).not.toHaveClass("text-primary-foreground");
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
        className="min-h-12 active:animate-spring-pop"
      >
        Ceramics
      </ToggleChip>,
    );

    const chip = screen.getByRole("button", { name: "Ceramics" });
    expect(chip).toHaveClass("min-h-12");
    expect(chip).toHaveClass("active:animate-spring-pop");
    // size="chip" maps to the Button size variant's h-8 track
    expect(chip).toHaveClass("h-8");
  });
});
