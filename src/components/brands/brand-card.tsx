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
import { Badge } from "@/components/ui/badge";
import { brandImageFill } from "@/lib/images/fill";
import { getBrandCategoryLabel } from "@/lib/brands/category-label";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import type { BrandProductPreview } from "@/lib/services/curated-products";
import { PREVIEW_THUMBNAIL_LIMIT } from "@/lib/services/curated-products.constants";
import { selectBrandCardImage } from "@/lib/brands/image-selection";
import { NO_SNIPPET } from "@/lib/seo/snippet";
import { SaveBrandButton } from "./save-brand-button";
import { BrandImageFallback } from "./brand-image-fallback";
import { BrandAvatar } from "./brand-avatar";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";

// Shared by the directory and the cover-image articles: the whole-card link
// relies on `relative` for its overlay and on the focus ring for keyboard users.
const CARD_ARTICLE_CLASS =
  "group relative block has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent";

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
  /** Directory variant only: published-product count and up to 3 thumbnails. */
  preview?: BrandProductPreview;
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
  preview,
}: BrandCardProps) {
  const t = useTranslations("brands");
  const tCities = useTranslations("cities");
  const locale = useLocale();
  // Safe on surfaces with no SavedBrandsProvider — the hook falls back to an empty set.
  const { savedIds } = useSavedBrands();
  const [imgError, setImgError] = useState(false);

  const categoryLabel = getBrandCategoryLabel(
    brand,
    locale === "en" ? "en" : "zh-TW",
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
  // One link element for every variant: the whole-card overlay and the click
  // analytics must not drift between the directory and the other layouts.
  // Every variant is a whole-card click target: the name link's `::after`
  // covers the `relative` article.
  const nameLink = (
    <Link
      href={routes.brand(brand.slug)}
      prefetch={variant === "directory" ? false : undefined}
      className="focus-visible:outline-none after:absolute after:inset-0"
      onClick={() => {
        if (variant === "recommendation") {
          trackRecommendationBrandClicked(
            brand.id,
            brand.slug,
            sourceBrandSlug ?? "",
            position,
          );
        } else {
          trackBrandCardClicked(
            brand.slug,
            brand.categoryLabel,
            position,
            brand.id,
            listSource,
          );
        }
        if (savedIds.has(brand.id)) {
          trackSavedBrandRevisited(brand.slug, "card", brand.id);
        }
      }}
      data-ph-no-autocapture
    >
      {brand.name}
    </Link>
  );

  // Recommendation cards (related brands, search fallbacks) share the
  // directory layout; they keep their own variant so the click analytics above
  // still report them as recommendations. They carry no save control.
  if (variant === "directory" || variant === "recommendation") {
    const cityLabel =
      brand.city && tCities.has(brand.city) ? tCities(brand.city) : null;
    const metadata = [categoryLabel, cityLabel].filter(Boolean).join(" · ");
    const thumbnails = (preview?.thumbnails ?? [])
      .map((src) => safeImageSrc(src))
      .filter((src): src is string => src !== null)
      .slice(0, PREVIEW_THUMBNAIL_LIMIT);

    return (
      <article
        className={surfaceCardStyles({
          tone: "white",
          // h-full fills the grid cell so every strip in a row can sit on
          // the same bottom edge (mt-auto below).
          className: cn(CARD_ARTICLE_CLASS, "h-full"),
          interactive: true,
          padding: "none",
        })}
      >
        <div className="flex h-full flex-col gap-3 p-5">
          {/* The save control overlays the mark's corner, as on /discover;
              z-20 lifts it above the whole-card link's overlay. */}
          <div className="relative w-fit shrink-0">
            <BrandAvatar
              name={brand.name}
              imageSrc={safeImageSrc(brand.heroImageUrl)}
              size="lg"
              showName={false}
              preload={preload}
            />
            {variant === "directory" ? (
              <SaveBrandButton
                brandId={brand.id}
                slug={brand.slug}
                name={brand.name}
                variant="overlay"
                className="-right-3 -top-3 z-20"
              />
            ) : null}
          </div>
          <h3 className="type-card-title line-clamp-2 text-ink">{nameLink}</h3>
          {metadata ? (
            <p className="type-metadata text-ink-soft">{metadata}</p>
          ) : null}
          {/* Same snippet suppression as the editorial variant below. */}
          <p {...NO_SNIPPET} className="type-body-sm line-clamp-2">
            {blurb ?? " "}
          </p>
          {preview && preview.count > 0 ? (
            <div className="mt-auto flex items-center gap-2">
              {thumbnails.map((src, index) => (
                <div
                  key={`${index}-${src}`}
                  className="relative size-12 shrink-0 overflow-hidden rounded-surface bg-surface-deep"
                >
                  <SurfaceImage
                    src={src}
                    alt=""
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                </div>
              ))}
              <span className="ms-auto type-metadata text-ink-soft">
                {t("card.productCount", { count: preview.count })}
              </span>
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  // Only the editorial variant reaches here: the directory and recommendation
  // cards lead with the logo mark, so only it needs the selected cover image.
  const selectedImage = selectBrandCardImage(brand);
  const imageSrc = selectedImage?.src ?? null;
  const showImage = imageSrc != null && !imgError;
  const imageFill = brandImageFill(selectedImage?.meta, { inset: "p-6" });

  return (
    <article
      className={surfaceCardStyles({
        className: CARD_ARTICLE_CLASS,
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
        <SaveBrandButton
          brandId={brand.id}
          slug={brand.slug}
          name={brand.name}
          variant="overlay"
        />
      </div>

      {/* Content */}
      <div className="p-4">
        {eyebrow ? (
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
           * line with its neighbours.
           */}
          <h3 className="min-w-0 line-clamp-2 min-h-10 type-body-sm font-semibold text-ink">
            {nameLink}
          </h3>
        </div>
        {/*
          A reserved block: a fixed
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
      </div>
    </article>
  );
}
