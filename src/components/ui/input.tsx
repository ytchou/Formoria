"use client"

import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"
import { useFormFieldContext } from "@/components/forms/form-field"

/**
 * A native `<input>`, deliberately. No ARIA wrapper, no combobox shell — the
 * only ARIA here is the error wiring, which describes state the platform has
 * no attribute for. 44px tall, 4px radius, and a drawn 2px accent ring on
 * `:focus-visible` standing in for the suppressed outline.
 */
function Input({
  className,
  type,
  'aria-invalid': ariaInvalidProp,
  'aria-describedby': ariaDescribedByProp,
  ...props
}: React.ComponentProps<"input">) {
  const formField = useFormFieldContext()

  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-[4px] border border-rule bg-transparent px-3.5 py-2 font-hei text-base text-ink transition-colors outline-none",
        "file:inline-flex file:h-11 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink",
        "placeholder:text-ink-muted",
        "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-50",
        "aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/30",
        "md:text-sm",
        className
      )}
      aria-invalid={ariaInvalidProp ?? (formField.error || undefined)}
      aria-describedby={ariaDescribedByProp ?? formField.errorId}
      {...props}
    />
  )
}

export { Input }
