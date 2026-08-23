"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { getPageRange } from "@/lib/pagination";

type EventExhibitorPaginationProps = {
  currentPage: number;
  pageCount: number;
  onPageChange: (page: number) => void;
};

const EDGE_CLASS =
  "inline-flex min-h-12 items-center justify-center rounded-control px-3 type-body-sm font-medium text-ink/20";

/**
 * Buttons, not links — the one deliberate divergence from
 * `src/components/brands/pagination.tsx`, whose accessible markup this
 * otherwise mirrors (and whose `getPageRange` it reuses verbatim).
 *
 * `/events/[slug]` reads no dynamic API by design: a `searchParams` read flips
 * the route to dynamic and `revalidate = 3600` then never produces a static
 * entry (see the CRITICAL comment in that route). So page state lives in the
 * client and syncs through `history.replaceState`, like the zone param.
 */
export function EventExhibitorPagination({
  currentPage,
  pageCount,
  onPageChange,
}: EventExhibitorPaginationProps) {
  const t = useTranslations("events");

  if (pageCount <= 1) return null;

  const pages = getPageRange(currentPage, pageCount);

  return (
    <nav
      aria-label={t("paginationLabel")}
      // `flex-wrap`, unlike the directory's pagination this is modelled on: 305
      // exhibitors is 16 pages, so the range renders its full seven numbers next
      // to two text labels, and at 375px that row is ~30px wider than the
      // viewport. The directory only escapes it by having fewer pages.
      className="mt-8 flex flex-wrap items-center justify-center gap-1"
    >
      {currentPage > 1 ? (
        <Button
          type="button"
          variant="ghost"
          aria-label={t("paginationPreviousAria")}
          size="large"
          onClick={() => onPageChange(currentPage - 1)}
        >
          {t("paginationPrevious")}
        </Button>
      ) : (
        <span className={EDGE_CLASS}>{t("paginationPrevious")}</span>
      )}

      {pages.map((page, index) =>
        page === "ellipsis" ? (
          <span
            key={`ellipsis-${index}`}
            className="inline-flex min-h-12 min-w-12 items-center justify-center type-body-sm text-ink/40"
          >
            …
          </span>
        ) : page === currentPage ? (
          <span
            key={page}
            aria-current="page"
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-control bg-accent type-metadata text-ground"
          >
            {page}
          </span>
        ) : (
          <Button
            key={page}
            type="button"
            variant="ghost"
            aria-label={t("paginationPageAria", { page })}
            className="min-w-12 px-0"
            size="large"
            onClick={() => onPageChange(page)}
          >
            {page}
          </Button>
        ),
      )}

      {currentPage < pageCount ? (
        <Button
          type="button"
          variant="ghost"
          aria-label={t("paginationNextAria")}
          size="large"
          onClick={() => onPageChange(currentPage + 1)}
        >
          {t("paginationNext")}
        </Button>
      ) : (
        <span className={EDGE_CLASS}>{t("paginationNext")}</span>
      )}
    </nav>
  );
}
