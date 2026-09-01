"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChipRow, ToggleChip } from "@/components/ui/toggle-chip";

type CategoryOption = {
  slug: string;
  label: string;
};

type CategoryFilterProps = {
  categories: CategoryOption[];
  children: ReactNode;
};

export function CategoryFilter({ categories, children }: CategoryFilterProps) {
  const [active, setActive] = useState("all");
  const containerRef = useRef<HTMLDivElement>(null);

  function handleSelect(slug: string) {
    if (slug === active) return;
    setActive(slug);

    const container = containerRef.current;
    if (!container) return;
    for (const group of container.querySelectorAll<HTMLElement>(
      "[data-category]",
    )) {
      group.hidden = group.dataset.category !== slug;
    }
  }

  return (
    <>
      <ChipRow className="mt-6 justify-center">
        {categories.map((cat) => (
          <ToggleChip
            key={cat.slug}
            pressed={active === cat.slug}
            onPressedChange={() => handleSelect(cat.slug)}
            className={
              active !== cat.slug
                ? "border-on-ink/40 text-on-ink hover:border-on-ink hover:bg-white/10 hover:text-on-ink"
                : undefined
            }
          >
            {cat.label}
          </ToggleChip>
        ))}
      </ChipRow>

      <div ref={containerRef}>{children}</div>
    </>
  );
}
