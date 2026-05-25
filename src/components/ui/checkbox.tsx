"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import type { CheckboxRootProps } from "@base-ui/react/checkbox"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

type CheckboxProps = CheckboxRootProps & {
  className?: string
}

function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer h-4 w-4 shrink-0 rounded border border-[#D4CFC9] bg-white",
        "data-[checked]:bg-[#E06B3F] data-[checked]:border-[#E06B3F]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B7355]/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
        <Check className="h-3 w-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
