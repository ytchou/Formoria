"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PublicBrandCard } from "@/lib/brands/contracts";
import { EmptyState } from "@/components/ui/empty-state";
import { Grid } from "@/components/ui/grid";
import { actionLinkStyles } from "@/components/ui/action-link";
import { trackCtaClicked } from "@/lib/analytics";
import { clearDirectoryFilters } from "@/lib/directory-filter-url";
import { BrandCard } from "./brand-card";
import { routes } from "@/lib/routes";

export type ActiveDirectoryFilter = {
  id: string;
  label: string;
  value: string;
  removeHref: string;
  removeLabel: string;
};

type SearchEmptyStateProps = {
  activeFilters: ActiveDirectoryFilter[];
  recommendedBrands: PublicBrandCard[];
  recommendationsHref: string;
};

export function SearchEmptyState({
  activeFilters,
  recommendedBrands,
  recommendationsHref,
}: SearchEmptyStateProps) {
  const t = useTranslations("search.emptyState");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasNonSearchFilters = activeFilters.some(
    (filter) => filter.id !== "search",
  );
  /*
   * The way out, built the same way the sidebar's own clear-all builds it
   * (`MobileClearAll`): drop every facet, KEEP the search. Two different exits
   * because they cost the reader different things — clearing filters keeps what
   * they asked for and widens where it is looked for, while browsing everything
   * abandons the question. Offering only "start over" would hide the cheaper of
   * the two.
   *
   * `usePathname` comes from `next/navigation`, NOT `@/i18n/navigation`, because
   * the links in this file are plain `next/link`. The i18n hook strips the
   * locale segment for the i18n `Link` to add back; pairing it with a plain
   * link would send an `/en` reader to the zh-TW path.
   */
  const clearFiltersHref = clearDirectoryFilters(pathname, searchParams);

  return (
    <div data-empty className="space-y-8">
      {/* The shared empty state: one design site-wide (DS-10). */}
      <EmptyState
        icon={<Search />}
        title={t("title")}
        /* h2 beside the sr-only results h2 (DEV-2023), under the page h1. */
        headingLevel={2}
        body={t("description")}
        action={
          /*
           * A zero-result page is the one page that cannot end. Both exits are
           * links, not buttons: they navigate, so they are reachable by
           * keyboard in reading order, openable in a new tab, and announced as
           * links. Two exits sit in the one action slot because they are one
           * choice (widen the search, or abandon it), not two competing CTAs.
           */
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {hasNonSearchFilters ? (
              <Link
                href={clearFiltersHref}
                data-ph-no-autocapture
                onClick={() =>
                  trackCtaClicked(
                    "clear_filters",
                    "empty_state",
                    clearFiltersHref,
                    routes.brands(),
                  )
                }
                className={actionLinkStyles()}
              >
                {t("actions.clearFilters.title")}
                <ArrowRight aria-hidden="true" />
              </Link>
            ) : null}
            <Link
              href={routes.brands()}
              data-ph-no-autocapture
              onClick={() =>
                trackCtaClicked(
                  "browse_all",
                  "empty_state",
                  routes.brands(),
                  routes.brands(),
                )
              }
              className={actionLinkStyles()}
            >
              {t("actions.browseAll.title")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        }
      />

      {recommendedBrands.length > 0 ? (
        <section className="border-t border-rule pt-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="type-card-title">{t("recommendations")}</h2>
            <Link
              href={recommendationsHref}
              data-ph-no-autocapture
              onClick={() =>
                trackCtaClicked(
                  "view_all",
                  "empty_state",
                  recommendationsHref,
                  routes.brands(),
                )
              }
              className={actionLinkStyles()}
            >
              {t("viewAll")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
          <Grid>
            {recommendedBrands.map((brand, index) => (
              <BrandCard
                key={brand.id}
                brand={brand}
                position={index}
                variant="recommendation"
              />
            ))}
          </Grid>
        </section>
      ) : null}
    </div>
  );
}
