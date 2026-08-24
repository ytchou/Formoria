"use client"

import type { InputHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  onCheckedChange?: (checked: boolean) => void
}

function Radio({ className, onCheckedChange, onChange, ref, ...props }: RadioProps & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      type="radio"
      data-slot="radio"
      className={cn(
        "size-4 cursor-pointer accent-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      onChange={(event) => {
        onChange?.(event)
        onCheckedChange?.(event.target.checked)
      }}
      {...props}
    />
  )
}

export { Radio }
