import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonSize = React.ComponentProps<typeof Button>["size"];

/**
 * THE 36px EXCEPTION, AND WHERE ITS PRICE IS PAID.
 *
 * Every other control in the system is 44px. A chip is 36px because a row of
 * 44px chips reads as a toolbar rather than as a set of options — but 36px
 * only clears the touch-target rule while neighbouring chips sit at least 14px
 * apart. The clear space is therefore not optional decoration; it is the other
 * half of the exception.
 *
 * IT LIVES ON THE ROW, NOT ON THE CHIP. The chip used to carry `m-[7px]` on
 * all four sides so that two flush chips were 14px apart whatever the parent
 * did. That is a safe default and a bad contract: a margin can only be
 * cancelled by a caller writing a matching negative margin, and 8 of 9 rows
 * kept their own `gap-2` instead — so the real gap was 8 + 7 + 7 = 22px, every
 * row sat 7px right of the heading above it, and `cn("mt-3", rowClasses)`
 * silently lost its `mt-3` because tailwind-merge reads `-m-*` as covering
 * `mt-*`. A gap cannot be double-counted, cannot shift a row, and cannot eat a
 * caller's margin.
 *
 * So: render chips inside {@link ChipRow}. `chip-row-contract.test.ts` fails
 * if a file renders a chip without one.
 */
const TOGGLE_CHIP_GAP_PX = 14;

/**
 * The row that owns the chip's clear space. Nothing else may set the gap.
 *
 * `gap` measures between margin boxes, so this only holds while the chip
 * itself carries no margin — which is why the chip has none.
 *
 * Written out rather than interpolated from {@link TOGGLE_CHIP_GAP_PX}: the
 * Tailwind compiler scans source text, so a template literal would emit no
 * `gap-[14px]` rule at all. `toggle-chip.test.tsx` asserts the two agree.
 */
const chipRowClasses = "flex flex-wrap gap-[14px]";

type ChipRowProps = React.HTMLAttributes<HTMLElement> & {
  /** `ul` when the chips are list items, which is the accessible shape for a
   *  row of links. Defaults to `div`, which is right for a group of buttons. */
  as?: "div" | "ul";
};

/**
 * A row of chips. The gap is 14px and is not a prop: a caller that could pass
 * `gap-2` would silently void the 36px exception, which is the whole reason
 * this component exists rather than an exported class string.
 *
 * `className` is for the row's own placement (`mt-3`) and flow
 * (`flex-nowrap overflow-x-auto`), and composes normally — no negative margin
 * to collide with.
 */
function ChipRow({ as = "div", className, ...props }: ChipRowProps) {
  const rowClassName = cn(chipRowClasses, className);

  return as === "ul" ? (
    <ul className={rowClassName} {...props} />
  ) : (
    <div className={rowClassName} {...props} />
  );
}

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

export { ChipRow, TOGGLE_CHIP_GAP_PX, ToggleChip, taxonomyLinkClasses };
