import { ArrowRight } from "lucide-react";
import { actionLinkStyles } from "@/components/ui/action-link";
import { ChipRow, taxonomyLinkClasses } from "@/components/ui/toggle-chip";
import { Link } from "@/i18n/navigation";
import { routes } from "@/lib/routes";

export type DiscoverEmptyRouteTrail = {
  slug: string;
  title: string;
  /** Set when the title's language differs from the page's (zh trail on /en). */
  lang?: string;
};

type DiscoverEmptyRouteCategory ={ slug: string; label: string };

type DiscoverEmptyRoutesProps = {
  /** Already trimmed by the caller (the page passes at most three). */
  trails: DiscoverEmptyRouteTrail[];
  categories: DiscoverEmptyRouteCategory[];
  trailsHeading: string;
  categoriesHeading: string;
  /** The brand search for the same query, when it finds any brand. */
  brandMatch?: { href: string; label: string } | null;
};

/**
 * The ways forward from a zero-result /discover search: the brands that match
 * the query, a few discovery trails, then every visible category. It sits beside `EmptyState` rather than
 * in its `action` slot because that slot takes a single control by contract.
 *
 * Props are localized data, not fetchers, so the page owns every read and
 * this renders the same in a test as on the page.
 */
export function DiscoverEmptyRoutes({
  trails,
  categories,
  trailsHeading,
  categoriesHeading,
  brandMatch,
}: DiscoverEmptyRoutesProps) {
  return (
    <div className="space-y-8">
      {brandMatch ? (
        <p className="border-t border-rule pt-6">
          <Link href={brandMatch.href} className={actionLinkStyles()}>
            {brandMatch.label}
            <ArrowRight aria-hidden="true" />
          </Link>
        </p>
      ) : null}

      {trails.length > 0 ? (
        <section className="border-t border-rule pt-6">
          <h2 className="type-card-title">{trailsHeading}</h2>
          <ul className="mt-3 flex flex-col items-start gap-1">
            {trails.map((trail) => (
              <li key={trail.slug}>
                <Link
                  href={routes.trail(trail.slug)}
                  className={actionLinkStyles()}
                >
                  <span lang={trail.lang}>{trail.title}</span>
                  <ArrowRight aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {categories.length > 0 ? (
        <section className="border-t border-rule pt-6">
          <h2 className="type-card-title">{categoriesHeading}</h2>
          <ChipRow as="ul" className="mt-3">
            {categories.map((category) => (
              <li key={category.slug}>
                <Link
                  href={routes.discover({ category: category.slug })}
                  prefetch={false}
                  className={taxonomyLinkClasses()}
                >
                  {category.label}
                </Link>
              </li>
            ))}
          </ChipRow>
        </section>
      ) : null}
    </div>
  );
}
