"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { textStyles } from "./text-styles"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-4 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-stretch justify-start border-border text-muted-foreground group-data-horizontal/tabs:min-h-12 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:border-r group-data-vertical/tabs:border-b-0",
  {
    variants: {
      variant: {
        default: "border-b bg-transparent",
        line: "gap-1 border-b bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex min-h-12 flex-none items-center justify-center gap-1.5 rounded-none border border-transparent px-4 py-2 whitespace-nowrap text-muted-foreground transition-[background-color,border-color,color] group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:bg-muted/60 hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        textStyles({ variant: "navItem" }),
        "data-active:text-foreground dark:data-active:text-foreground",
        "after:absolute after:bg-primary after:opacity-0 after:transition-opacity motion-reduce:after:transition-none group-data-horizontal/tabs:after:inset-x-3 group-data-horizontal/tabs:after:-bottom-px group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-3 group-data-vertical/tabs:after:-right-px group-data-vertical/tabs:after:w-0.5 data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger }
