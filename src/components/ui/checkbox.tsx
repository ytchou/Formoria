"use client"

import type { InputHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  indeterminate?: boolean
  onCheckedChange?: (checked: boolean) => void
}

function Checkbox({ className, indeterminate, onCheckedChange, ref, ...props }: CheckboxProps & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <input
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate
        if (typeof ref === "function") ref(el)
        else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = el
      }}
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "size-4 cursor-pointer accent-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // A native box takes no border colour, so the error state is a ring
        // (box-shadow), which leaves the browser's focus outline intact.
        "aria-invalid:ring-2 aria-invalid:ring-danger aria-invalid:ring-offset-2 aria-invalid:ring-offset-ground",
        className
      )}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  )
}

export { Checkbox }
