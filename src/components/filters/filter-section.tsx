"use client";

import { useId, type ReactNode } from "react";

type FilterSectionProps = {
  title: string;
  children: ReactNode;
};

/**
 * A static filter group: a heading and its options, always open.
 *
 * This used to be an accordion. Collapsed groups hid the options a shopper
 * came to scan, and opening one pushed the rest of the sidebar a screen
 * down. Long option lists are truncated inside `FilterCheckboxGroup` instead,
 * which keeps every group visible at a glance.
 */
export function FilterSection({ title, children }: FilterSectionProps) {
  const headingId = useId();

  return (
    <div role="group" aria-labelledby={headingId} className="space-y-2">
      <p id={headingId} className="px-2 type-label text-ink-soft">
        {title}
      </p>
      {children}
    </div>
  );
}
