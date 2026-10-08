import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ProductSearchBoxCompact } from "@/components/products/product-situation-search-form";
import { actionLinkStyles } from "@/components/ui/action-link";
import { PhotoBand } from "@/components/ui/photo-band";
import { ChipRow, taxonomyLinkClasses } from "@/components/ui/toggle-chip";
import { routes } from "@/lib/routes";
import type { TrailEntry } from "@/lib/services/trails";
import { contentLangFor } from "@/lib/trails/content-lang";
import { trailShortTitle } from "@/lib/trails/trail-short-title";
import { cn } from "@/lib/utils";

/** Situation chips under the search: enough to show the shape, not a menu. */
const HERO_SITUATION_LIMIT = 4;

/**
 * THE EDITORIAL OPENER: TEXT FIRST, THEN THE FRAME.
 *
 * The text is left-aligned so every homepage zone shares one reading edge.
 * One message — the promise and its lede — then search, style discovery, and
 * a row of situation chips (the first published trails) as the entry points.
 *
 * Below `sm` the photograph stacks above the copy with no scrim
 * (`stackBelowSm`): a full-width scrim on a phone washed the picture out.
 *
 * `preload` and the literal image path are both load-bearing:
 * `scripts/check-photo-band-contrast.ts` reads the `image` prop from source
 * to know which pixels to measure, and a band it cannot resolve fails the lint
 * chain. Both `landing-zones.tsx` and `selected-product-tile.tsx` withhold
 * their preload "because the photograph in the opener owns it".
 */
export default async function HeroSection({
  trails,
}: {
  trails: TrailEntry[];
}) {
  const t = await getTranslations("landing.hero");
  const locale = await getLocale();
  // `lang` marks a chip whose trail is in another language than the page, so
  // a screen reader switches voice (as TrailTile does for its title).
  const situations = trails.slice(0, HERO_SITUATION_LIMIT).map((trail) => ({
    trail,
    lang: contentLangFor(trail.frontmatter.locale, locale),
  }));
  const showLanguageNote = situations.some(
    (situation) => situation.lang !== undefined,
  );

  return (
    <PhotoBand
      image="/images/home-hero.webp"
      alt=""
      scrim="left"
      preload
      stackBelowSm
    >
      <div className="prose-measure">
        {/* Decorative eyebrow carrying the category — a `span`, not a `p`.
            DEV-1320 requires the lede to be the FIRST paragraph so Google does
            not lift a rotating brand blurb as the homepage snippet. */}
        <span className="block type-eyebrow text-ink-soft">{t("eyebrow")}</span>

        {/* The consumer promise, in its display form (no closing 。, per
            brand-voice.md). `type-display` from `md` up; the
            page-title role below it, because 46px zh-TW characters overflow a
            390px viewport at this string's length. The zh message carries a
            `<wbr>` and `break-keep` forbids every other break, so a narrow
            screen wraps 生活可以 / 更像自己一點 and nowhere else. */}
        <h1 className="mt-4 type-page-title md:type-display text-balance break-keep">
          {t.rich("headline", { wbr: () => <wbr /> })}
        </h1>

        {/* FIRST PROSE NODE, AND IT STAYS THAT WAY (DEV-1320). Google lifted a
            rotating brand blurb as the homepage snippet when it was not. */}
        <p className="mt-6 type-body text-ink-soft">{t("lede")}</p>

        {/* One search control and one style-discovery alternative. */}
        <div className="mt-8 flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6">
          <Suspense
            fallback={<div className="h-11 w-full flex-1" aria-hidden="true" />}
          >
            <ProductSearchBoxCompact
              src="hero"
              placeholder={t("searchPlaceholder")}
              label={t("searchLabel")}
              className="max-w-none flex-1"
            />
          </Suspense>

          <div className="flex items-center gap-3">
            <span className="type-metadata text-ink-soft">
              {t("browsePrefix")}
            </span>
            <Link href={routes.style()} className={actionLinkStyles()}>
              {t("browseCta")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>

        {/* Situations are zh-TW trail titles; on another locale a note says
            so, and the chips sit closer under it. */}
        {showLanguageNote && (
          <p className="mt-6 type-metadata text-ink-soft">
            {t("situationsLanguageNote")}
          </p>
        )}

        {/* Situation chips: start from a need, not a brand name. Below `sm`
            they form one horizontal scroll row instead of wrapping into an
            orphaned last chip. The row's overflow would clip the chips' focus
            rings, so it carries 6px of padding inside a matching negative
            margin (as the trail snap row in landing-zones.tsx does) and 6px
            less top margin, which keeps the visual gap. */}
        {situations.length > 0 && (
          <ChipRow
            as="ul"
            aria-label={t("situationsLabel")}
            className={cn(
              "max-sm:-mx-1.5 max-sm:snap-x max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:p-1.5",
              showLanguageNote ? "mt-2" : "mt-6 max-sm:mt-4.5",
            )}
          >
            {situations.map((situation) => (
              <li key={situation.trail.slug} className="shrink-0 snap-start">
                <Link
                  href={routes.trail(situation.trail.slug)}
                  lang={situation.lang}
                  className={taxonomyLinkClasses()}
                >
                  {trailShortTitle(situation.trail.frontmatter.title)}
                </Link>
              </li>
            ))}
          </ChipRow>
        )}
      </div>
    </PhotoBand>
  );
}
