import { Link } from "@/i18n/navigation";
import { VISIBLE_L1_CATEGORIES, categoryLabel } from "@/lib/taxonomy/ontology";
import { routes } from "@/lib/routes";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ProductFilterSidebarProps = {
  locale: string;
  activeCategory: string | null;
  allLabel: string;
};

function filterLinkClasses(isActive: boolean) {
  return cn(
    buttonVariants({
      variant: isActive ? "primary" : "ghost",
      size: "compact",
    }),
    "type-nav justify-start",
    !isActive && "text-ink-muted",
  );
}

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
            className={filterLinkClasses(activeCategory === null)}
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
                className={filterLinkClasses(isActive)}
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
