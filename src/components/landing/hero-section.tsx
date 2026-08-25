import { Suspense } from "react";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { SearchInput } from "@/components/brands/search-input";
import { PhotoBand } from "@/components/ui/photo-band";
import { ChipRow, taxonomyLinkClasses } from "@/components/ui/toggle-chip";
import { categoryLabel } from "@/lib/taxonomy/ontology";
import { routes } from "@/lib/routes";

/**
 * THE EDITORIAL OPENER: CENTRED LAYOUT WITH CATEGORY CHIPS.
 *
 * Rewritten from a left-aligned PhotoBand opener to a centred layout with a
 * category chip row. The photograph stays as the BACKGROUND behind a scrim —
 * the same `PhotoBand` construction the manifesto band in `landing-zones.tsx`
 * uses, deliberately, so the page does not hold two different ideas of what a
 * photographic band is.
 *
 * The chip row reinstates category navigation inside the hero. The first chip
 * is "全部品牌" (all brands) and is the only one that ships active — the rest
 * navigate to filtered views.
 *
 * `preload` and the literal image path are both load-bearing:
 * `scripts/check-photo-band-contrast.ts` reads the `image` prop from source
 * to know which pixels to measure, and a band it cannot resolve fails the lint
 * chain. Both `landing-zones.tsx` and `selected-product-tile.tsx` withhold
 * their preload "because the photograph in the opener owns it".
 */
export default async function HeroSection({
  categories,
  locale,
}: {
  categories: Array<{ slug: string; name: string; nameZh: string | null }>;
  locale: string;
}) {
  const t = await getTranslations("landing.hero");

  return (
    <PhotoBand
      image="/images/home-hero.webp"
      alt=""
      scrim="left"
      preload
      contentClassName="text-center"
    >
      <div className="prose-measure mx-auto">
        {/* Decorative eyebrow — a `span`, not a `p`. DEV-1320 requires the
            positioning line to be the FIRST paragraph so Google does not lift a
            rotating brand blurb as the homepage snippet. */}
        <span className="block type-eyebrow text-ink-soft">
          {t("eyebrow")}
        </span>

        {/* The consumer promise, verbatim. `type-display` from `md` up; the
            page-title role below it, because 46px zh-TW characters overflow a
            390px viewport at this string's length. */}
        <h1 className="mt-4 type-page-title md:type-display text-balance">
          {t("headline")}
        </h1>

        {/* FIRST PROSE NODE, AND IT STAYS THAT WAY (DEV-1320). Google lifted a
            rotating brand blurb as the homepage snippet when it was not. */}
        <p className="mt-6 type-body text-ink-soft">{t("subheadline")}</p>

        {/* One search control that redirects to /brands?search=. */}
        <div className="mt-8 flex w-full justify-center">
          <Suspense
            fallback={
              <div className="h-11 w-full max-w-md" aria-hidden="true" />
            }
          >
            <SearchInput
              redirectTo={routes.brands()}
              placeholder={t("searchPlaceholder")}
              formAriaLabel={t("searchLabel")}
              className="max-w-md flex-1"
            />
          </Suspense>
        </div>

        {/* Category chips: links, not toggles. First chip is the "all brands"
            shortcut with `active: true`; the rest navigate to category views. */}
        <ChipRow className="mt-6 justify-center">
          <Link
            href={routes.brands()}
            className={taxonomyLinkClasses({ active: true })}
          >
            全部品牌
          </Link>
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              href={routes.brands({ category: cat.slug })}
              className={taxonomyLinkClasses()}
            >
              {categoryLabel(cat, locale)}
            </Link>
          ))}
        </ChipRow>
      </div>
    </PhotoBand>
  );
}
