"use client"

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

/**
 * Base UI, not Radix. This was the repo's last Radix-backed primitive, behind
 * three call sites, against a Base UI dependency every other primitive here
 * already uses — two floating-element libraries for one component.
 *
 * The four exports keep their Radix names and shapes so the call sites did not
 * move. What changed underneath: Base UI splits the content into
 * Portal → Positioner → Popup, and it deliberately gives the popup NO ARIA role
 * of its own, because its own documentation says a tooltip is a visual
 * affordance for sighted pointer and keyboard users and is not a way to deliver
 * information to assistive technology. `role="tooltip"` is set here anyway — an
 * unlabelled floating div is worse than a labelled one — but the rule that
 * follows from that doc still binds every caller: THE TRIGGER CARRIES ITS OWN
 * ACCESSIBLE NAME, and anything a user actually needs belongs in the page.
 */
function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider delay={delay} {...props} />
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root {...props} />
}

function TooltipTrigger({
  className,
  ...props
}: TooltipPrimitive.Trigger.Props) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      className={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "side" | "sideOffset">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        className="isolate z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          role="tooltip"
          data-slot="tooltip-content"
          className={cn(
            "origin-(--transform-origin) rounded-surface border border-rule bg-surface px-3 py-1.5 type-metadata text-ink transition-opacity duration-100 outline-none data-ending-style:opacity-0 data-instant:duration-0 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
