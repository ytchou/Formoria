"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type FilterSectionProps = {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function FilterSection({
  title,
  defaultOpen = false,
  children,
}: FilterSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="min-h-12 min-w-0 flex-1 justify-between px-2 text-left"
        >
          <span className="type-body-sm font-medium text-ink">{title}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-ink-muted transition-transform duration-200 motion-reduce:duration-[0.01ms]",
              !open && "-rotate-90",
            )}
            aria-hidden="true"
          />
        </Button>
      </div>
      {/*
        `grid-rows-[0fr]` hides the panel visually and nothing else: its
        checkboxes stayed in the tab order and in the accessibility tree, so a
        keyboard user tabbed through invisible controls with no focus ring
        (WCAG 2.4.3, 2.4.7). `inert` is what closes both, and unlike
        `display:none` it leaves the markup in the server HTML that crawlers
        and answer engines read (DESIGN.md §6).
      */}
      <div
        id={panelId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-200",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
        style={{ transitionTimingFunction: "var(--ease-settle)" }}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </section>
  );
}
