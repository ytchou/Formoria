import { ResultsLinkPendingReporter } from "@/components/filters/results-transition";
import { ChipRow, taxonomyLinkClasses } from "@/components/ui/toggle-chip";
import { Link } from "@/i18n/navigation";

export type DiscoverCategoryChip = {
  /** `null` is the all-categories chip. */
  slug: string | null;
  label: string;
  href: string;
};

type DiscoverCategoryChipsProps = {
  /** The nav's accessible name (the 分類 label). */
  label: string;
  chips: DiscoverCategoryChip[];
  activeCategory: string | null;
};

/**
 * /discover's category picker: the homepage band's chip vocabulary
 * (`ChipRow` + `taxonomyLinkClasses`) instead of a radio list in the filter
 * panel, so a category reads the same everywhere. Single-select, so each chip
 * is a real URL with `aria-current` on the active one; the page builds the
 * hrefs (a search keeps its `q`).
 *
 * Below `sm` the row scrolls sideways rather than wrapping into several rows
 * above the grid; `p-1` inside a matching negative margin keeps the chips'
 * focus ring inside the scroll box's clip.
 */
export function DiscoverCategoryChips({
  label,
  chips,
  activeCategory,
}: DiscoverCategoryChipsProps) {
  return (
    <nav aria-label={label}>
      <ChipRow
        as="ul"
        className="-m-1 flex-nowrap overflow-x-auto p-1 sm:m-0 sm:flex-wrap sm:overflow-visible sm:p-0"
      >
        {chips.map((chip) => {
          const isActive = chip.slug === activeCategory;
          return (
            <li key={chip.slug ?? "all"} className="shrink-0">
              <Link
                href={chip.href}
                prefetch={false}
                aria-current={isActive ? "page" : undefined}
                className={taxonomyLinkClasses({ active: isActive })}
              >
                {chip.label}
                <ResultsLinkPendingReporter />
              </Link>
            </li>
          );
        })}
      </ChipRow>
    </nav>
  );
}
