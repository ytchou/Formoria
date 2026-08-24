"use client";

import { useState } from "react";
import { SurfaceImage } from "@/components/ui/image";
import { ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import type { CreativeExpoEntry } from "@/lib/services/events";
import {
  trackBrandCardClicked,
  trackExhibitorSiteClicked,
} from "@/lib/analytics";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { NO_SNIPPET } from "@/lib/seo/snippet";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";

type EventExhibitorRowProps = {
  entry: CreativeExpoEntry;
  eventSlug: string;
  /**
   * Index in the whole filtered list, not within the current page — otherwise
   * `position_in_grid` would restart at 0 on every page and stop being
   * comparable across them.
   */
  position: number;
  /**
   * Outside the current page window. The row still renders in full — see
   * `EventExhibitorList` — it is only hidden with CSS.
   */
  hidden?: boolean;
};

const OUTBOUND_LINK_CLASS =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-deep hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/**
 * One exhibitor in the Creative Expo hall, listed by Formoria or not.
 *
 * Three shapes, because the row's click target changes with the data:
 * - listed: the name owns the stretched overlay (the whole row opens the brand
 *   page, `BrandCard`'s idiom) and the outbound link sits above it on `z-10`;
 * - unlisted with a site: there is no `/brands` target, so the outbound link
 *   carries the overlay and the row is one link;
 * - unlisted with no site: no link at all, and no hover or pointer affordance.
 */
export function EventExhibitorRow({
  entry,
  eventSlug,
  position,
  hidden = false,
}: EventExhibitorRowProps) {
  const t = useTranslations("events");
  const locale = useLocale();
  const isEnglish = locale === "en";
  const [imgError, setImgError] = useState(false);

  const brand = entry.brand;
  // Listed rows show the directory name so the row and the page it opens agree;
  // unlisted rows have only the official roster name, resolved by locale.
  const name = brand
    ? brand.name
    : isEnglish
      ? (entry.nameEn ?? entry.name)
      : entry.name;
  // The exact ladder `BrandCard` uses (brand-card.tsx) — the zh branch
  // deliberately has no English fallback. Unlisted rows have no brand blurb, so
  // they use the roster's own enriched summary and fall back to the area label
  // when that exhibitor has not been enriched yet.
  const summary = brand
    ? isEnglish
      ? (brand.blurbEn ??
        brand.descriptionEn ??
        brand.blurb ??
        brand.description)
      : (brand.blurb ?? brand.description)
    : isEnglish
      ? (entry.summaryEn ?? entry.summaryZh ?? entry.areaEn ?? entry.area)
      : (entry.summaryZh ?? entry.area);

  // A matched brand's hero image wins; the roster image is what an unlisted
  // exhibitor renders instead of the neutral monogram.
  const imageSrc = safeImageSrc(brand?.heroImageUrl ?? entry.imageUrl);
  const showImage = imageSrc !== null && !imgError;
  // A listed row's thumbnail stays decorative: the brand name sits beside it and
  // the whole row already links to the brand page. Roster-owned images for
  // unlisted exhibitors are also decorative (no curated alt text available).
  const imageAlt = "";
  const monogram = [...name][0] ?? "";
  const websiteUrl = entry.websiteUrl;
  const isRowLink = brand !== null || websiteUrl !== null;

  return (
    <li className={cn(hidden && "hidden")}>
      <div
        className={cn(
          "group relative flex gap-3 py-4 md:gap-4",
          isRowLink && "transition-colors hover:bg-surface-deep/40",
        )}
      >
        <div className="relative size-16 shrink-0 overflow-hidden rounded-surface border border-rule bg-surface-deep md:size-18">
          {showImage ? (
            <SurfaceImage
              src={imageSrc}
              alt={imageAlt}
              fill
              // `thumb` IS this box — a 64/72px square — so there is nothing to
              // override. The surface is fixed, not viewport-relative: every row
              // on the page renders a thumbnail at this one size, and a `100vw`
              // hint would have Next request a full-width variant for each.
              surface="thumb"
              className="object-contain"
              onError={() => setImgError(true)}
            />
          ) : (
            // A neutral monogram, not `BrandImageFallback`: that component tints
            // by category, and unlisted exhibitors have no category.
            <div className="flex h-full items-center justify-center">
              <span
                aria-hidden="true"
                className="type-card-title text-ink-muted"
              >
                {monogram}
              </span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1 md:flex-row md:gap-4">
          {/* Own line below `md`, its own column above — the responsive move
              `StoryRow` makes with its `<time>`. */}
          {/*
            Both states carry a label, not just the negative one. With only
            the not-yet-listed label rendered, a listed row was identified by
            the absence of a
            note — which reads as "no data" rather than "we cover this brand".
            The positive case gets the badge because it is the actionable one:
            it is the row whose name opens a Formoria page.
          */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 type-metadata md:w-24 md:shrink-0">
            {entry.booth ? (
              <span className="tabular-nums">{entry.booth}</span>
            ) : null}
            {brand ? (
              <Badge variant="success">{t("exhibitorListed")}</Badge>
            ) : (
              <span>{t("exhibitorNotListed")}</span>
            )}
          </p>

          <div className="min-w-0 flex-1 space-y-1">
            <p className="type-card-title">
              {brand ? (
                <Link
                  href={routes.brand(brand.slug)}
                  prefetch={false}
                  className="after:absolute after:inset-0 focus-visible:outline-none group-hover:underline"
                  onClick={() =>
                    trackBrandCardClicked(
                      brand.slug,
                      brand.categoryLabel,
                      position,
                      brand.id,
                    )
                  }
                >
                  {name}
                </Link>
              ) : (
                name
              )}
            </p>
            {summary ? (
              /* Repeated list copy, kept out of Google's snippet selection —
                 see NO_SNIPPET. */
              <p {...NO_SNIPPET} className="line-clamp-2 type-body-sm">
                {summary}
              </p>
            ) : null}
          </div>
        </div>

        {websiteUrl ? (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            aria-label={t("exhibitorOfficialSiteAria", { name })}
            title={t("exhibitorOfficialSite")}
            onClick={() =>
              trackExhibitorSiteClicked(
                entry.sourceKey,
                eventSlug,
                entry.booth,
                brand?.slug ?? null,
              )
            }
            className={cn(
              OUTBOUND_LINK_CLASS,
              // Listed rows: above the name's stretched overlay, so the link
              // stays clickable and independently focusable. Unlisted rows have
              // no overlay, so the outbound link becomes it.
              brand ? "relative z-10" : "after:absolute after:inset-0",
            )}
          >
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null}
      </div>
    </li>
  );
}
