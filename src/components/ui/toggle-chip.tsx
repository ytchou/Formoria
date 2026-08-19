import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonSize = React.ComponentProps<typeof Button>["size"];

/**
 * THE 36px EXCEPTION, AND THE PRICE OF IT.
 *
 * Every other control in the system is 44px. A chip is 36px because a row of
 * 44px chips reads as a toolbar rather than as a set of options — but 36px
 * only clears the touch-target rule while neighbouring chips sit at least 14px
 * apart. A chip that a caller can render flush against its neighbour voids the
 * exception, so the gap is part of the chip and not of the caller's
 * discipline: every chip carries half the gap on all four sides, which means
 * two flush chips are 14px apart in either axis whatever the parent does.
 *
 * Containers that need the row to line up flush with the surrounding column
 * cancel the outer ring with `toggleChipRowClasses`.
 */
const TOGGLE_CHIP_GAP_PX = 14;

/** Half of {@link TOGGLE_CHIP_GAP_PX}, on all four sides. */
const toggleChipSpacingClasses = "m-[7px]";

/** For a chip row: cancels the outer half-gap so the row aligns flush. */
const toggleChipRowClasses = "-m-[7px] flex flex-wrap";

/**
 * Default state — a rule outline, never an ink one. The chip is an option, not
 * an emphasis, and the accent is reserved for the selected state.
 *
 * The underlying `secondary` variant carries `hover:bg-surface`. twMerge treats
 * a hover-variant class and an unmodified one as different keys, so a base-only
 * treatment survives the merge but loses the cascade — hovering a selected chip
 * would repaint it as unselected. Every rule is therefore restated at hover
 * scope, here and below.
 */
const toggleChipDefaultClasses = cn(
  "border-rule text-ink",
  "hover:border-ink hover:bg-surface hover:text-ink",
);

/**
 * The selected treatment, exported so link-shaped chips (filters that live in
 * the query string and must work with JS off) can wear it without cloning it.
 * One definition, two call shapes.
 */
const toggleChipSelectedClasses = cn(
  "border-accent bg-accent text-ground",
  "hover:border-accent hover:bg-accent hover:text-ground",
);

function taxonomyLinkClasses({
  active = false,
  className,
}: {
  active?: boolean;
  className?: string;
} = {}) {
  return buttonVariants({
    variant: "secondary",
    shape: "pill",
    size: "chip",
    className: cn(
      toggleChipSpacingClasses,
      toggleChipDefaultClasses,
      active && toggleChipSelectedClasses,
      className,
    ),
  });
}

type ToggleChipProps = Omit<
  React.ComponentProps<"button">,
  "aria-pressed" | "onClick" | "type"
> & {
  /** Whether the chip is currently selected. */
  pressed: boolean;
  /** Called with the negated pressed state when the chip is activated. */
  onPressedChange: (pressed: boolean) => void;
  /**
   * `default` uses the accent fill for the selected state.
   * `reference` is a read-only baseline treatment that never uses the accent —
   * in this design system the accent means exactly one thing: interaction, and
   * on this control specifically, a change being proposed.
   */
  tone?: "default" | "reference";
  size?: ButtonSize;
};

function ToggleChip({
  pressed,
  onPressedChange,
  tone = "default",
  size = "chip",
  className,
  disabled,
  children,
  ...props
}: ToggleChipProps) {
  const isReference = tone === "reference";

  return (
    <Button
      type="button"
      variant="secondary"
      shape="pill"
      size={size}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
      // Reference tone restates every rule at hover scope for the same twMerge
      // reason documented on `toggleChipDefaultClasses`.
      className={cn(
        toggleChipSpacingClasses,
        isReference
          ? cn(
              "border-border bg-secondary text-foreground",
              "hover:border-border hover:bg-secondary hover:text-foreground",
              !pressed &&
                "text-muted-foreground line-through hover:text-muted-foreground",
            )
          : cn(toggleChipDefaultClasses, pressed && toggleChipSelectedClasses),
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export {
  TOGGLE_CHIP_GAP_PX,
  ToggleChip,
  taxonomyLinkClasses,
  toggleChipRowClasses,
};
