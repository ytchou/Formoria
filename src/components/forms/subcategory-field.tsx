"use client";

import { useMemo, useState } from "react";

import {
  SubcategoryPicker,
  type SubcategoryPickerLabels,
} from "@/components/forms/subcategory-picker";
import { resolveSubcategorySelection } from "@/lib/services/subcategories";

/**
 * Stable identity for the default. `suggestions = []` written inline is a new
 * array on every render, which defeats the memo below and, through it, the
 * picker's own 175-node memo.
 */
const NO_SUGGESTIONS: string[] = [];

type SubcategoryFieldProps = {
  initialSubcategories?: string[];
  value?: string[];
  onChange?: (subcategories: string[]) => void;
  /**
   * The directory's most-used subcategories, as stored values or labels. They
   * do not widen the offer set — every one of the 175 nodes is offered either
   * way — they only float to the top of their group, which is what keeps a
   * closed picker of that size navigable.
   */
  suggestions?: string[];
  /** The brand's own L1, offered first. The other twelve still follow. */
  categorySlug?: string | null;
  locale?: string;
  labels: SubcategoryPickerLabels;
};

/**
 * The owner-facing wrapper around the shared closed picker.
 *
 * The hidden input is TRANSPORT, not display: it carries the stored slugs to a
 * server action verbatim. The chips beside it render localized labels through
 * the picker, so no owner ever sees `tote-bags` on screen.
 */
export function SubcategoryField({
  initialSubcategories,
  value: controlledSubcategories,
  onChange,
  suggestions = NO_SUGGESTIONS,
  categorySlug = null,
  locale = "zh-TW",
  labels,
}: SubcategoryFieldProps) {
  const [internalSubcategories, setInternalSubcategories] = useState(
    () => initialSubcategories ?? [],
  );
  const subcategories = controlledSubcategories ?? internalSubcategories;

  // Memoized because the picker lists it as a dependency: rebuilt inline it
  // handed the picker a new array on every keystroke of every other field in
  // the wizard form, replaying the full 175-node scan each time.
  const prioritySlugs = useMemo(
    () =>
      suggestions
        .map((suggestion) => resolveSubcategorySelection(suggestion))
        .flatMap((resolved) => (resolved.ok ? [resolved.slug] : [])),
    [suggestions],
  );

  function updateSubcategories(next: string[]) {
    if (controlledSubcategories === undefined) {
      setInternalSubcategories(next);
    }
    onChange?.(next);
  }

  return (
    <div className="space-y-2">
      <input
        type="hidden"
        name="subcategories"
        value={subcategories.join(",")}
      />
      <SubcategoryPicker
        value={subcategories}
        onChange={updateSubcategories}
        labels={labels}
        surface="brand-wizard"
        locale={locale}
        priorityCategorySlug={categorySlug}
        prioritySlugs={prioritySlugs}
      />
    </div>
  );
}
