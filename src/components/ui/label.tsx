"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { textStyles } from "./text-styles"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        textStyles({ variant: "formLabel" }),
        className
      )}
      {...props}
    />
  )
}

export { Label }
