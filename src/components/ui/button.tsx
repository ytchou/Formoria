import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { CONTROL_ICON, DISABLED_STATE, FOCUS_RING } from "./control-surface"

/**
 * THREE INTERACTION VARIANTS, PLUS ONE DANGER SEMANTIC.
 *
 * `primary` fills with the accent, `secondary` is an ink outline over nothing,
 * `ghost` is accent text over nothing. `destructive` is not a fourth
 * interaction weight — it is the danger token, which the palette keeps
 * separate from the accent on purpose.
 *
 * `overlay` and the `tone: "cta"` axis are gone. Both existed to paint a
 * SECOND interaction colour, and v2 has one: `--accent`. A variant that can
 * only be described as "the other accent" is the drift this list prevents, so
 * it is exported and asserted rather than left implicit in the cva config.
 */
const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "destructive"] as const

type ButtonVariant = (typeof BUTTON_VARIANTS)[number]

const buttonStyles = cva(
  cn(
    "group/button inline-flex shrink-0 items-center justify-center border bg-clip-padding font-hei text-sm font-medium whitespace-nowrap",
    "transition-[background-color,border-color,color] select-none",
    FOCUS_RING,
    DISABLED_STATE,
    "aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/30",
    CONTROL_ICON,
  ),
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-accent text-ground hover:bg-accent/90 [a]:hover:bg-accent/90",
        secondary:
          "border-ink bg-transparent text-ink hover:bg-surface aria-expanded:bg-surface",
        ghost:
          "border-transparent bg-transparent text-accent hover:bg-surface aria-expanded:bg-surface",
        destructive:
          "border-transparent bg-transparent text-danger hover:bg-danger/10",
      },
      shape: {
        // 4px on controls. Softer radii read as app chrome; the warm-paper
        // direction wants a paper edge.
        default: "rounded-[4px]",
        pill: "rounded-full",
        square: "rounded-[2px]",
      },
      size: {
        // h-11 is 44px — the touch minimum, and the height of every button.
        default:
          "h-11 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        compact:
          "h-11 gap-1 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        // The ONE exception to 44px, and only inside the chip's own spacing
        // contract — see `toggle-chip.tsx`.
        chip: "h-9 gap-1 px-3.5 text-[0.8125rem]/[1.4] font-medium [&_svg:not([class*='size-'])]:size-3.5",
        // 48px. Carries `default`'s px-4 rather than a wider px-5: there is ONE
        // 48px button, not two differing only in padding. 57 call sites used to
        // spell this as a `min-h-12` className override.
        large:
          "h-12 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-11",
      },
      /**
       * Width is an AXIS, not a className.
       *
       * 25 call sites used to append `w-full` by hand. A button that fills its
       * container is a variant of the button, not a local override of it — and
       * every override of this shape is how the geometry drifted in the first
       * place.
       */
      width: {
        auto: "",
        full: "w-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      shape: "default",
      size: "default",
      width: "auto",
    },
  }
)

type ButtonStyleVariants = VariantProps<typeof buttonStyles>

type ButtonStyleProps = Omit<ButtonStyleVariants, "variant"> & {
  variant?: ButtonVariant
  className?: string
}

function buttonVariants({
  variant = "primary",
  shape = "default",
  size = "default",
  width = "auto",
  className,
}: ButtonStyleProps = {}) {
  return cn(buttonStyles({ variant, shape, size, width }), className)
}

function Button({
  className,
  variant = "primary",
  shape = "default",
  size = "default",
  width = "auto",
  ...props
}: ButtonPrimitive.Props & ButtonStyleProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonVariants({ variant, shape, size, width, className })}
      {...props}
    />
  )
}

export { BUTTON_VARIANTS, Button, buttonVariants }
