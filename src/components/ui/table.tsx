"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { textStyles } from "./text-styles"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = React.useState(false)

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () =>
      setOverflows(container.scrollWidth > container.clientWidth + 1)
    measure()
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(measure)
      : null
    observer?.observe(container)
    if (container.firstElementChild) observer?.observe(container.firstElementChild)
    return () => observer?.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      className="relative w-full overflow-x-auto focus-visible:-outline-offset-2"
      tabIndex={overflows ? 0 : undefined}
      role={overflows ? "region" : undefined}
      aria-label={overflows ? props["aria-label"] : undefined}
      aria-labelledby={overflows ? props["aria-labelledby"] : undefined}
      onKeyDown={(event) => {
        if (
          event.target !== event.currentTarget || !overflows ||
          event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        ) return
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        event.currentTarget.scrollBy({
          left: event.key === "ArrowRight"
            ? event.currentTarget.clientWidth
            : -event.currentTarget.clientWidth,
        })
      }}
    >
      <table
      data-slot="table"
      className={cn("w-full caption-bottom", textStyles({ variant: "body" }), className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-surface/50 has-aria-expanded:bg-surface/50 data-[state=selected]:bg-surface",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        textStyles({ variant: "bodyEmphasis" }),
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
}
