"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { trackDirectoryPageNavigated } from "@/lib/analytics";
import { getPageRange } from "@/lib/pagination";
import { parseCommaParam } from "@/lib/seo/directory-filters";
import { RESULTS_HEADING_ID } from "./results-heading";

interface PaginationProps {
  totalCount: number;
  currentPage: number;
  pageSize: number;
}

function buildPageUrl(
  pathname: string,
  searchParams: URLSearchParams,
  page: number,
): string {
  const params = new URLSearchParams(searchParams.toString());
  if (page > 1) {
    params.set("page", String(page));
  } else {
    params.delete("page");
  }
  const str = params.toString();
  return str ? `${pathname}?${str}` : pathname;
}

const navLinkClass =
  "relative inline-flex min-h-12 items-center justify-center gap-1 rounded-control px-3 type-nav text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const pageLinkClass =
  "relative inline-flex min-h-12 min-w-12 items-center justify-center rounded-control type-nav text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function PaginationLinkStatus() {
  const { pending } = useLinkStatus();

  return (
    <Loader2
      aria-hidden="true"
      className={`pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 transition-opacity ${pending ? "animate-spin opacity-100" : "opacity-0"}`}
    />
  );
}

function getPageDirection(
  targetPage: number,
  currentPage: number,
): "prev" | "next" | "jump" {
  if (targetPage < currentPage) return "prev";
  if (targetPage === currentPage + 1) return "next";
  return "jump";
}

/**
 * The links keep `scroll={false}` (Next would otherwise jump to the page top),
 * so after a pager click the reader would be left by the footer. Once the new
 * page renders, move them to the results heading instead. Only a pager click
 * arms this: a filter or sort change also resets `currentPage`, and those keep
 * the results in place (DESIGN §7b). The scroll is always instant, never
 * smooth, so `prefers-reduced-motion` needs no branch.
 */
function usePagerFocus(currentPage: number) {
  const pending = useRef(false);

  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    const heading = document.getElementById(RESULTS_HEADING_ID);
    if (!heading) return;
    heading.scrollIntoView({ block: "start" });
    heading.focus({ preventScroll: true });
  }, [currentPage]);

  return () => {
    pending.current = true;
  };
}

export function Pagination({
  totalCount,
  currentPage,
  pageSize,
}: PaginationProps) {
  const t = useTranslations("brands");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const totalPages = Math.ceil(totalCount / pageSize);
  const armPagerFocus = usePagerFocus(currentPage);

  if (totalPages <= 1) return null;

  const pages = getPageRange(currentPage, totalPages);
  // A multi-value `sub=` page is a noindex facet, and its page links are the
  // only internal links to further combinations (DEV-2018). robots.txt blocks
  // them too; nofollow stops crawlers from queueing them in the first place.
  const rel =
    parseCommaParam(searchParams.getAll("sub")).length > 1
      ? "nofollow"
      : undefined;

  return (
    <nav
      aria-label={t("pagination.label")}
      className="mt-10 flex items-center justify-center gap-1"
    >
      {/* Previous */}
      {currentPage > 1 ? (
        <Link
          href={buildPageUrl(pathname, searchParams, currentPage - 1)}
          className={navLinkClass}
          aria-label={t("pagination.previousAria")}
          rel={rel}
          prefetch={false}
          scroll={false}
          onClick={() => {
            armPagerFocus();
            trackDirectoryPageNavigated(currentPage - 1, "prev", totalPages);
          }}
          data-ph-no-autocapture
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {t("pagination.previous")}
          <PaginationLinkStatus />
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex min-h-12 items-center justify-center gap-1 rounded-control px-3 type-nav text-ink-muted/50"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {t("pagination.previous")}
        </span>
      )}

      {/* Below `sm` the number list would wrap to a second line, so it
          collapses to one position line between previous and next. */}
      <span
        role="status"
        aria-live="polite"
        className="inline-flex min-h-12 items-center px-2 type-nav tabular-nums text-ink-soft sm:hidden"
      >
        {t("pagination.status", { page: currentPage, total: totalPages })}
      </span>

      {/* Page numbers, from `sm` up */}
      <span className="hidden flex-wrap items-center justify-center gap-1 sm:flex">
      {pages.map((page, i) => {
        if (page === "ellipsis") {
          return (
            <span
              key={`ellipsis-${i}`}
              className="inline-flex min-h-12 min-w-12 items-center justify-center type-nav text-ink-muted"
            >
              …
            </span>
          );
        }

        const isActive = page === currentPage;

        if (isActive) {
          return (
            <span
              key={page}
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-control bg-accent type-nav text-ground"
              aria-current="page"
            >
              {page}
            </span>
          );
        }

        return (
          <Link
            key={page}
            href={buildPageUrl(pathname, searchParams, page)}
            className={pageLinkClass}
            rel={rel}
            prefetch={false}
            scroll={false}
            onClick={() => {
              armPagerFocus();
              trackDirectoryPageNavigated(
                page,
                getPageDirection(page, currentPage),
                totalPages,
              );
            }}
            data-ph-no-autocapture
          >
            {page}
            <PaginationLinkStatus />
          </Link>
        );
      })}
      </span>

      {/* Next */}
      {currentPage < totalPages ? (
        <Link
          href={buildPageUrl(pathname, searchParams, currentPage + 1)}
          className={navLinkClass}
          aria-label={t("pagination.nextAria")}
          rel={rel}
          prefetch={false}
          scroll={false}
          onClick={() => {
            armPagerFocus();
            trackDirectoryPageNavigated(currentPage + 1, "next", totalPages);
          }}
          data-ph-no-autocapture
        >
          {t("pagination.next")}
          <ChevronRight aria-hidden="true" className="size-4" />
          <PaginationLinkStatus />
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex min-h-12 items-center justify-center gap-1 rounded-control px-3 type-nav text-ink-muted/50"
        >
          {t("pagination.next")}
          <ChevronRight aria-hidden="true" className="size-4" />
        </span>
      )}
    </nav>
  );
}
