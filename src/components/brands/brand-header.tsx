import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import type { PublicBrandDetail } from "@/lib/brands/contracts";
import { buildBrandMetaLineParts } from "@/lib/brands/brand-meta-line";
import { phraseBreaks } from "@/components/ui/phrase-breaks";
import type {
  BrandChannelSlot,
  BrandStockistCity,
} from "@/lib/services/brand-detail-view";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { BrandChannelRows } from "./brand-links";

/** Joins short interface parts: 「・」 in zh, a spaced middle dot in en. */
function listSeparator(locale: string): string {
  return locale === "en" ? " · " : "・";
}

interface BrandHeaderProps {
  brand: PublicBrandDetail;
  categoryLabel?: string | null;
  cityLabel?: string | null;
  /** The brand's own first sentence (`splitLede`), set under the metadata line. */
  lede?: string | null;
  /** 「做什麼」: subcategory labels set under the metadata line (BD-01). */
  makesLabels?: string[];
  /**
   * Leave city and founding year out of the metadata line because
   * `BrandHeroFacts` sets them as the colophon (BD2-31).
   */
  omitProvenance?: boolean;
  actionsSlot?: ReactNode;
  adminSlot?: ReactNode;
}

export function BrandHeader({
  brand,
  categoryLabel,
  cityLabel,
  lede,
  makesLabels = [],
  omitProvenance = false,
  actionsSlot,
  adminSlot,
}: BrandHeaderProps) {
  const t = useTranslations("brandDetail");
  const locale = useLocale();
  // One plain line instead of a labelled spec block (BD-11): an unknown part is
  // left out, never printed as a placeholder.
  const metaParts = buildBrandMetaLineParts({
    categoryLabel: categoryLabel ?? brand.categoryLabel,
    cityLabel: omitProvenance ? null : cityLabel,
    foundingYear: omitProvenance ? null : brand.foundingYear,
    formatFoundingYear: (year) => t("label.founded", { year }),
  });

  // The page's one staged entrance (BD-32): name, metadata line, lede, then
  // actions, 100ms apart. Reduced motion is handled globally in globals.css.
  return (
    <div className="flex flex-col gap-stack">
      <div className="space-y-3">
        {/* Brand name. The display step of the content face: this is the one
            piece of copy the whole page is about, and it is the brand's own
            name, not interface chrome. */}
        <div className="flex animate-reveal-up items-start justify-between gap-4">
          {/* A brand name is a proper noun: `break-keep` keeps each Han run
              whole and breaks at its spaces (「劉一刀手工鞋／LID Shoes」). No
              phraseBreaks() here: the dictionary splits 手工／鞋. A run wider
              than the column still wraps via the hero's overflow-wrap. */}
          <Typography as="h1" balance variant="hero" className="break-keep">
            {brand.name}
          </Typography>
          {adminSlot}
        </div>
        {metaParts.length > 0 || makesLabels.length > 0 ? (
          // One reveal step for both lines: what the brand is, then what it
          // makes.
          <div
            className="space-y-1 animate-reveal-up"
            style={{ animationDelay: "100ms" }}
          >
            {metaParts.length > 0 ? (
              <p className="type-metadata">{metaParts.join(" · ")}</p>
            ) : null}
            {makesLabels.length > 0 ? (
              <p className="type-label text-ink-soft" data-brand-makes>
                {makesLabels.join(listSeparator(locale))}
              </p>
            ) : null}
          </div>
        ) : null}
        {lede ? (
          <p
            className="type-lede animate-reveal-up break-keep"
            style={{ animationDelay: "200ms" }}
          >
            {phraseBreaks(lede)}
          </p>
        ) : null}
      </div>

      {actionsSlot ? (
        <div className="animate-reveal-up" style={{ animationDelay: "300ms" }}>
          {actionsSlot}
        </div>
      ) : null}
    </div>
  );
}

interface BrandHeroFactsProps {
  cityLabel: string | null;
  foundingYear: number | null;
  selectedCount: number;
  stockistCount: number;
  /** The cities with the most stockists, most first (`topStockistCities`). */
  stockistCities?: BrandStockistCity[];
  /** Every live brand channel, for the route rows (BD-06). */
  channels?: BrandChannelSlot[];
  /** What the channel rows' click tracking needs; required with channels. */
  trackedBrand?: { id: string; slug: string };
}

/** Whether `BrandHeroFacts` renders anything for these props. */
export function hasBrandHeroFacts({
  cityLabel,
  foundingYear,
  selectedCount,
  stockistCount,
  channels = [],
}: BrandHeroFactsProps): boolean {
  return (
    Boolean(cityLabel) ||
    foundingYear != null ||
    selectedCount > 0 ||
    stockistCount > 0 ||
    channels.length > 0
  );
}

/**
 * The lower half of the hero's info column (BD2-04, BD2-31): a provenance
 * colophon — the page's one bold typographic moment, city and founding year
 * set large in 明體 — then the routes out: one row per live brand channel
 * (BD-06), and in-page jump rows to the sections that carry counts. Static:
 * no motion, surface, or shadow.
 */
export function BrandHeroFacts({
  cityLabel,
  foundingYear,
  selectedCount,
  stockistCount,
  stockistCities = [],
  channels = [],
  trackedBrand,
}: BrandHeroFactsProps) {
  const t = useTranslations("brandDetail");
  const tCities = useTranslations("cities");
  const locale = useLocale();
  const hasColophon = Boolean(cityLabel) || foundingYear != null;
  const channelRows = trackedBrand ? channels : [];

  // 「台中市 5 家・台北市 5 家・看全部 24 家」: the by-city summary names
  // where most stockists are; "see all" only when those cities leave some out.
  const shownStockists = stockistCities.reduce(
    (sum, city) => sum + city.count,
    0,
  );
  const stockistLabel =
    stockistCities.length > 0
      ? [
          ...stockistCities.map((city) =>
            t("heroJump.stockistCity", {
              city: tCities(city.citySlug),
              count: city.count,
            }),
          ),
          ...(shownStockists < stockistCount
            ? [t("heroJump.stockistsAll", { count: stockistCount })]
            : []),
        ].join(listSeparator(locale))
      : t("heroJump.stockists", { count: stockistCount });

  const jumps = [
    ...(selectedCount > 0
      ? [
          {
            href: "#selected-products",
            label: t("heroJump.selected", { count: selectedCount }),
          },
        ]
      : []),
    ...(stockistCount > 0
      ? [{ href: "#where-to-buy", label: stockistLabel }]
      : []),
  ];
  if (!hasColophon && jumps.length === 0 && channelRows.length === 0) {
    return null;
  }

  return (
    // With no colophon only the route rows are left, and those are md-only.
    <div
      className={cn(
        "flex flex-col gap-stack border-t border-rule pt-stack",
        !hasColophon && "max-md:hidden",
      )}
    >
      {hasColophon ? (
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          {cityLabel ? (
            <div>
              <dt className="type-metadata">{t("colophon.city")}</dt>
              <dd className="type-page-title tabular-nums">{cityLabel}</dd>
            </div>
          ) : null}
          {foundingYear != null ? (
            <div>
              <dt className="type-metadata">{t("colophon.founded")}</dt>
              <dd className="type-page-title tabular-nums">{foundingYear}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {/* Below md the where-to-buy section, straight after the products,
          carries the same rows and the section-nav strip indexes the page. */}
      {trackedBrand && channelRows.length > 0 ? (
        <BrandChannelRows
          brand={trackedBrand}
          slots={channelRows}
          ariaLabel={t("heroJump.channels")}
          className="hidden md:block"
        />
      ) : null}
      {jumps.length > 0 ? (
        <nav aria-label={t("tabNav.overview")} className="hidden md:block">
          <ul className="divide-y divide-rule border-y border-rule">
            {jumps.map((jump) => (
              <li key={jump.href}>
                <a
                  href={jump.href}
                  className="flex min-h-11 items-center justify-between gap-3 type-label text-ink transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {jump.label}
                  <ArrowDown className="size-4 shrink-0" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
