import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonStyles = cva(
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        overlay: "bg-accent/80 text-accent-foreground backdrop-blur-sm hover:bg-accent",
      },
      tone: {
        default: "",
        cta: "bg-cta text-cta-foreground [a]:hover:bg-cta/90 hover:bg-cta/90",
      },
      shape: {
        default: "rounded-xl",
        pill: "rounded-full",
        square: "rounded-md",
      },
      size: {
        default:
          "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        compact: "h-10 gap-1 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        chip: "h-8 gap-1 px-3.5 text-[0.8125rem]/[1.4] font-medium [&_svg:not([class*='size-'])]:size-3.5",
        large:
          "h-11 gap-1.5 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      tone: "default",
      shape: "default",
      size: "default",
    },
  }
)

type ButtonStyleVariants = VariantProps<typeof buttonStyles>

type ButtonToneProps =
  | {
      variant?: "primary"
      tone?: "default" | "cta"
    }
  | {
      variant: "secondary" | "ghost" | "destructive" | "overlay"
      tone?: "default"
    }

type ButtonStyleProps = ButtonToneProps &
  Omit<ButtonStyleVariants, "variant" | "tone"> & {
    className?: string
  }

function buttonVariants({
  variant = "primary",
  tone = "default",
  shape = "default",
  size = "default",
  className,
}: ButtonStyleProps = {}) {
  return cn(buttonStyles({ variant, tone, shape, size }), className)
}

function Button({
  className,
  variant = "primary",
  tone = "default",
  shape = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & ButtonStyleProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonVariants({ variant, tone, shape, size, className } as ButtonStyleProps)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
