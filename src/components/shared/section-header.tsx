import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { actionLinkStyles } from "@/components/ui/action-link";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  /** Heading text. Always renders as the zone's `h2` — the hero keeps the only `h1`. */
  heading: ReactNode;
  /**
   * DOM id for the heading. Supply it when the wrapping `<section>` carries
   * `aria-labelledby`, so the landmark takes its name from the visible heading
   * instead of a duplicated `aria-label`.
   */
  id?: string;
  /** One line of context under the heading. */
  note?: ReactNode;
  /** Both `linkHref` and `linkLabel` are required before the link renders. */
  linkHref?: string;
  linkLabel?: ReactNode;
  className?: string;
}

/**
 * The one section header for a page zone. It replaces four inlined
 * near-duplicates whose markup had diverged — one carried `aria-labelledby`,
 * one carried nothing — so the accessible name of every zone is now built the
 * same way.
 *
 * It lives in `shared/` rather than `landing/` because it knows nothing about
 * the landing page: `BrandShowcase` already consumes it from `shared/`, and a
 * shared component must not drag a route-specific folder behind it.
 *
 * Alignment is deliberately left at the page gutter, including next to the
 * centred hero: a centred header row loses the reading edge the zones below it
 * share. The site-wide `h2::before` accent bar this comment used to describe
 * was deleted in design system v2 — elevation and emphasis are borders and
 * type, never a decorative rule.
 */
export function SectionHeader({
  heading,
  id,
  note,
  linkHref,
  linkLabel,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 id={id} className="type-page-title">
          {heading}
        </h2>
        {note ? (
          // `prose-measure`, the one reading width — the note is a sentence of
          // body copy under a page title, and its band is as wide as the page.
          <p className="prose-measure mt-2 type-body-sm">{note}</p>
        ) : null}
      </div>

      {linkHref && linkLabel ? (
        <Link
          href={linkHref}
          className={actionLinkStyles({ className: "ml-auto shrink-0" })}
        >
          {linkLabel}
          <ArrowRight aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}
