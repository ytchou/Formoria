import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

/**
 * A bare `<button>` for Base UI `render` props.
 *
 * Base UI's `render` prop injects the PARENT's styling into whatever element it
 * is handed — a `DropdownMenuItem` already paints its own row, a `SheetTrigger`
 * its own trigger. Passing `<Button>` there would stack a second set of
 * heights, borders and paddings on top of styling that is already correct.
 *
 * So these sites legitimately need a raw element — but "legitimately raw" was
 * being spelled as four copies of a per-site lint escape, which is the
 * carve-out this codebase is removing. Living in `src/components/ui/` (the one
 * directory the lint rule exempts) turns a recurring exception into a named
 * component with a stated reason.
 *
 * Use this ONLY inside a `render` prop. Anywhere else, use `<Button>`.
 */
function UnstyledButton({
  className,
  type = "button",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      data-slot="unstyled-button"
      type={type}
      className={cn(className)}
      {...props}
    />
  )
}

export { UnstyledButton }
