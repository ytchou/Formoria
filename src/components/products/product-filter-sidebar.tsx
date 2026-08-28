import { Link } from "@/i18n/navigation";
import { VISIBLE_L1_CATEGORIES, categoryLabel } from "@/lib/taxonomy/ontology";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

type ProductFilterSidebarProps = {
  locale: string;
  activeCategory: string | null;
  allLabel: string;
};

export function ProductFilterSidebar({
  locale,
  activeCategory,
  allLabel,
}: ProductFilterSidebarProps) {
  return (
    <nav aria-label={allLabel}>
      <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
        <li>
          <Link
            href={routes.discover()}
            aria-current={activeCategory === null ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-control px-3 py-1.5 type-nav transition-colors",
              "hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              activeCategory === null
                ? "bg-accent text-ground"
                : "text-ink-muted",
            )}
          >
            {allLabel}
          </Link>
        </li>
        {VISIBLE_L1_CATEGORIES.map((category) => {
          const isActive = activeCategory === category.slug;
          const label = categoryLabel(category, locale);
          return (
            <li key={category.slug}>
              <Link
                href={routes.discover({ category: category.slug })}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-control px-3 py-1.5 type-nav transition-colors",
                  "hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  isActive ? "bg-accent text-ground" : "text-ink-muted",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
