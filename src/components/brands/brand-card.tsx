"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { SurfaceImage } from "@/components/ui/image";
import { useTranslations, useLocale } from "next-intl";
import type { PublicBrandCard } from "@/lib/brands/contracts";
import {
  trackBrandCardClicked,
  trackRecommendationBrandClicked,
  trackSavedBrandRevisited,
} from "@/lib/analytics";
import { useSavedBrands } from "@/hooks/use-saved-brands";
import { surfaceCardStyles } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { brandImageFill } from "@/lib/images/fill";
import {
  getBrandCategoryLabel,
  getBrandSubcategoryLabels,
} from "@/lib/brands/category-label";
import { selectBrandCardImage } from "@/lib/brands/image-selection";
import { NO_SNIPPET } from "@/lib/seo/snippet";
import { SaveBrandButton } from "./save-brand-button";
import { BrandImageFallback } from "./brand-image-fallback";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";

interface BrandCardProps {
  brand: PublicBrandCard;
  position?: number;
  preload?: boolean;
  variant?: "directory" | "recommendation" | "editorial";
  sourceBrandSlug?: string;
  /** Stable analytics identifier for the list or rail containing this card. */
  listSource?: string;
  /** Internal image candidate hint for a surface with a custom card width. */
  imageSizes?: string;
  /**
   * Editorial variant only: the author's line about this brand, shown in place
   * of the generated blurb so a story's own voice wins over directory copy.
   */
  note?: string;
  /** Editorial variant only: short kicker above the brand name. */
  eyebrow?: string;
}

export function BrandCard({
  brand,
  position = 0,
  preload = false,
  variant = "directory",
  sourceBrandSlug,
  listSource,
  imageSizes,
  note,
  eyebrow,
}: BrandCardProps) {
  const t = useTranslations("brands");
  const locale = useLocale();
  // Safe on surfaces with no SavedBrandsProvider — the hook falls back to an empty set.
  const { savedIds } = useSavedBrands();
  const [imgError, setImgError] = useState(false);
  const selectedImage = selectBrandCardImage(brand);
  const imageSrc = selectedImage?.src ?? null;
  const showImage = imageSrc != null && !imgError;
  const imageFill = brandImageFill(selectedImage?.meta, { inset: "p-6" });

  const categoryLabel = getBrandCategoryLabel(
    brand,
    locale === "en" ? "en" : "zh-TW",
  );
  // Compact surfaces show the first five STORED L2s without expanding the
  // card. Directory/search data still carries the complete array.
  const compactSubcategories = getBrandSubcategoryLabels(brand, locale).slice(
    0,
    5,
  );
  // The directory blurb, resolved once: both the directory variant and the
  // editorial variant (as its fallback when there is no curator note) render it,
  // and two copies of this chain drift apart the next time it changes.
  const blurb =
    locale === "en"
      ? (brand.blurbEn ??
        brand.descriptionEn ??
        brand.blurb ??
        brand.description)
      : (brand.blurb ?? brand.description);
  // Directory and editorial cards are whole-card click targets with a save
  // affordance; recommendation cards use an explicit button instead.
  const isWholeCardLink = variant === "directory" || variant === "editorial";

  return (
    <article
      className={surfaceCardStyles({
        className:
          "group relative block has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
        interactive: true,
        padding: "none",
      })}
    >
      {/* Image */}
      {/* `surface-deep` is DESIGN.md §2's third step, the documented image
          placeholder. It replaces v1's `bg-muted` on every image plate in one
          pass, so two adjacent image boxes can never sit in different tones. */}
      <div className="relative z-10 aspect-media overflow-hidden rounded-t-surface bg-surface-deep">
        {showImage ? (
          <SurfaceImage
            src={imageSrc}
            alt={selectedImage?.meta?.altZh ?? ""}
            fill
            preload={preload}
            sizes={imageSizes}
            className={cn(
              "transition-transform group-hover:scale-[1.02]",
              imageFill,
            )}
            surface="card"
            onError={() => setImgError(true)}
          />
        ) : (
          <BrandImageFallback
            name={brand.name}
            category={brand.categoryLabel}
            size="card"
          />
        )}
        {isWholeCardLink ? (
          <SaveBrandButton
            brandId={brand.id}
            slug={brand.slug}
            variant="overlay"
          />
        ) : null}
      </div>

      {/* Content */}
      <div className="p-4">
        {variant === "editorial" && eyebrow ? (
          /*
           * Micro-text, not a `Badge`: three grey pills across a `<BrandRow>`
           * read as chrome inside prose. `type-eyebrow` is the declared
           * 11px uppercase tracked utility — never hand-pick the size here.
           */
          <p className="mb-2 type-eyebrow">{eyebrow}</p>
        ) : null}
        <div className="flex min-w-0 items-center gap-1.5">
          {/*
           * Editorial titles get two lines with a reserved two-line height: at
           * the ~229px card width of a 3-up row `truncate` cut real brand names
           * mid-word, and an unreserved clamp let a 1-line card ride up out of
           * line with its neighbours. Every other variant keeps `truncate` —
           * the directory and recommendation surfaces must not change.
           */}
          <h3
            className={cn(
              "min-w-0 type-body-sm font-semibold text-ink",
              variant === "editorial" ? "line-clamp-2 min-h-10" : "truncate",
            )}
          >
            <Link
              href={routes.brand(brand.slug)}
              prefetch={variant === "directory" ? false : undefined}
              className={cn(
                "focus-visible:outline-none",
                isWholeCardLink && "after:absolute after:inset-0",
              )}
              onClick={() => {
                if (variant === "recommendation") {
                  trackRecommendationBrandClicked(
                    brand.id,
                    brand.slug,
                    sourceBrandSlug ?? "",
                    position,
                  );
                } else {
                  if (listSource) {
                    trackBrandCardClicked(
                      brand.slug,
                      brand.categoryLabel,
                      position,
                      brand.id,
                      listSource,
                    );
                  } else {
                    trackBrandCardClicked(
                      brand.slug,
                      brand.categoryLabel,
                      position,
                      brand.id,
                    );
                  }
                }
                if (savedIds.has(brand.id)) {
                  trackSavedBrandRevisited(brand.slug, "card", brand.id);
                }
              }}
              data-ph-no-autocapture
            >
              {brand.name}
            </Link>
          </h3>
        </div>
        {variant === "recommendation" ? (
          <>
            {categoryLabel ? (
              <p className="mt-1 truncate type-body-sm">{categoryLabel}</p>
            ) : null}
            <Link
              href={routes.brand(brand.slug)}
              className={buttonVariants({
                variant: "secondary",
                size: "large",
                width: "full",
                className: "relative z-20 mt-4",
              })}
              onClick={() =>
                trackRecommendationBrandClicked(
                  brand.id,
                  brand.slug,
                  sourceBrandSlug ?? "",
                  position,
                )
              }
              data-ph-no-autocapture
            >
              {t("card.viewBrand")}
            </Link>
          </>
        ) : variant === "editorial" ? (
          <>
            {/*
              Same reserved block as the directory variant below: a fixed
              minimum height plus a two-line clamp so every card in a
              `<BrandGrid>` row lands its badge row on the same baseline,
              whatever length note the author wrote. Rendered unconditionally
              (with a space) for the same reason — a card without a note must
              still occupy the block, or it pulls its badges up out of line.
            */}
            {/*
              Curator note first, directory blurb second: a lineup card with no
              note said nothing about the brand at all, and the blurb is the
              same copy the directory card shows for it.
            */}
            {/*
              Repeated card copy, so it is kept out of Google's snippet
              selection — see NO_SNIPPET. The brand's own description still
              serves snippets from its detail page.
            */}
            <p
              {...NO_SNIPPET}
              className="mt-1.5 min-h-[2.625rem] type-body-sm text-ink-soft line-clamp-2"
            >
              {note ?? blurb ?? " "}
            </p>
            {categoryLabel ? (
              <div className="mt-3 flex items-center gap-1.5 overflow-hidden">
                <Badge variant="secondary">{categoryLabel}</Badge>
              </div>
            ) : null}
          </>
        ) : (
          <>
            {/* Same snippet suppression as the editorial variant above. */}
            <p
              {...NO_SNIPPET}
              className="mt-1.5 min-h-[2.625rem] type-body-sm line-clamp-2"
            >
              {blurb ?? " "}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 overflow-hidden">
              {categoryLabel && (
                <Badge variant="secondary">{categoryLabel}</Badge>
              )}
              {compactSubcategories.map((subcategory, index) => (
                <Badge
                  key={`${subcategory}-${index}`}
                  variant="secondary"
                  className="max-w-full truncate"
                >
                  {subcategory}
                </Badge>
              ))}
            </div>
          </>
        )}
      </div>
    </article>
  );
}
