import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonSize = React.ComponentProps<typeof Button>["size"];

type ToggleChipProps = Omit<
  React.ComponentProps<"button">,
  "aria-pressed" | "onClick" | "type"
> & {
  /** Whether the chip is currently selected. */
  pressed: boolean;
  /** Called with the negated pressed state when the chip is activated. */
  onPressedChange: (pressed: boolean) => void;
  /**
   * `default` uses the kiln/primary fill for the selected state.
   * `reference` is a read-only baseline treatment that never uses the kiln
   * accent — in this design system kiln means exactly one thing: a change
   * being proposed.
   */
  tone?: "default" | "reference";
  size?: ButtonSize;
};

function ToggleChip({
  pressed,
  onPressedChange,
  tone = "default",
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
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
      // The underlying `secondary` variant carries `hover:bg-muted
      // hover:text-foreground`. twMerge treats a hover-variant class and an
      // unmodified one as different keys, so a base-only selected treatment
      // survives the merge but loses the cascade — hovering a selected chip
      // would repaint it as unselected. Every selected/reference rule is
      // therefore restated at hover scope.
      className={cn(
        isReference
          ? cn(
              "border-border bg-secondary text-foreground",
              "hover:border-border hover:bg-secondary hover:text-foreground",
              !pressed &&
                "text-muted-foreground line-through hover:text-muted-foreground",
            )
          : pressed &&
              cn(
                "border-primary bg-primary text-primary-foreground",
                "hover:border-primary hover:bg-primary hover:text-primary-foreground",
              ),
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export { ToggleChip };
