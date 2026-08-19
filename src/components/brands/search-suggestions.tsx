"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { SearchSuggestion } from "@/lib/brands/contracts";
import { getCategoryLabel } from "@/lib/brands/category-label";

interface SearchSuggestionsProps {
  suggestions: SearchSuggestion[];
  selectedIndex: number;
  onSelect: (slug: string, index: number) => void;
  query: string;
  /**
   * The listbox's DOM id, supplied by the owning `SearchInput` so it is unique
   * per instance. The homepage renders two search fields at `md+` (hero and
   * nav); with one shared constant both listboxes could be mounted at once
   * under the same id, and `aria-controls` then resolved to the other field's
   * options.
   */
  id: string;
}

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent/10 text-ink rounded-sm">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/**
 * The DOM id of one option, namespaced by its listbox. `aria-activedescendant`
 * on the input is built from the same helper, so two search fields on one page
 * cannot point at each other's options.
 */
export function searchSuggestionOptionId(
  listboxId: string,
  suggestionId: string,
): string {
  return `${listboxId}-option-${suggestionId}`;
}

export function SearchSuggestions({
  suggestions,
  selectedIndex,
  onSelect,
  query,
  id,
}: SearchSuggestionsProps) {
  const t = useTranslations("brands");
  const locale = useLocale();
  return (
    <ul
      id={id}
      role="listbox"
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-[3px] border border-rule bg-card"
    >
      {suggestions.length === 0 ? (
        <li className="px-4 py-3 type-body-sm">
          {t("noResultsInSuggestions")}
        </li>
      ) : (
        suggestions.map((item, index) => (
          <li
            key={item.id}
            id={searchSuggestionOptionId(id, item.id)}
            role="option"
            aria-selected={index === selectedIndex}
            onClick={() => onSelect(item.slug, index)}
            className={`cursor-pointer px-4 py-3 type-body-sm text-ink-soft ${
              index === selectedIndex ? "bg-surface" : "hover:bg-surface"
            }`}
          >
            <span className="font-medium text-ink">
              {highlightMatch(item.name, query)}
            </span>
            {item.categoryLabel && (
              <span className="ml-2 type-metadata">
                {highlightMatch(
                  getCategoryLabel(
                    item.categoryLabel,
                    locale === "zh-TW" ? "zh-TW" : "en",
                  ) ?? item.categoryLabel,
                  query,
                )}
              </span>
            )}
          </li>
        ))
      )}
    </ul>
  );
}
