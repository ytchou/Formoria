import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { SearchInput } from "@/components/brands/search-input";
import { actionLinkStyles } from "@/components/ui/action-link";
import { PhotoBand } from "@/components/ui/photo-band";
import { routes } from "@/lib/routes";

/**
 * THE EDITORIAL OPENER: TEXT FIRST, THEN THE FRAME.
 *
 * The text is left-aligned so every homepage zone shares one reading edge.
 * Search and style discovery remain the two entry points beneath the original
 * positioning copy.
 *
 * `preload` and the literal image path are both load-bearing:
 * `scripts/check-photo-band-contrast.ts` reads the `image` prop from source
 * to know which pixels to measure, and a band it cannot resolve fails the lint
 * chain. Both `landing-zones.tsx` and `selected-product-tile.tsx` withhold
 * their preload "because the photograph in the opener owns it".
 */
export default async function HeroSection() {
  const t = await getTranslations("landing.hero");

  return (
    <PhotoBand image="/images/home-hero.webp" alt="" scrim="left" preload>
      <div className="prose-measure">
        {/* Decorative eyebrow — a `span`, not a `p`. DEV-1320 requires the
            positioning line to be the FIRST paragraph so Google does not lift a
            rotating brand blurb as the homepage snippet. */}
        <span className="block type-eyebrow text-ink-soft">{t("eyebrow")}</span>

        {/* The consumer promise, verbatim. `type-display` from `md` up; the
            page-title role below it, because 46px zh-TW characters overflow a
            390px viewport at this string's length. */}
        <h1 className="mt-4 type-page-title md:type-display text-balance">
          {t("headline")}
        </h1>

        {/* FIRST PROSE NODE, AND IT STAYS THAT WAY (DEV-1320). Google lifted a
            rotating brand blurb as the homepage snippet when it was not. */}
        <p className="mt-6 type-body text-ink-soft">{t("subheadline")}</p>
        <p className="mt-3 type-body text-ink-soft">{t("lede")}</p>

        {/* One search control and one style-discovery alternative. */}
        <div className="mt-8 flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6">
          <Suspense
            fallback={<div className="h-11 w-full flex-1" aria-hidden="true" />}
          >
            <SearchInput
              redirectTo={routes.brands()}
              placeholder={t("searchPlaceholder")}
              formAriaLabel={t("searchLabel")}
              className="max-w-none flex-1"
            />
          </Suspense>

          <div className="flex items-center gap-3">
            <span className="type-metadata text-ink-soft">
              {t("browsePrefix")}
            </span>
            <Link href={routes.discover()} className={actionLinkStyles()}>
              {t("browseCta")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </PhotoBand>
  );
}
