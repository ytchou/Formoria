import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import type { PublicBrandDetail } from "@/lib/brands/contracts";
import { buildBrandMetaLineParts } from "@/lib/brands/brand-meta-line";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

interface BrandHeaderProps {
  brand: PublicBrandDetail;
  categoryLabel?: string | null;
  cityLabel?: string | null;
  /** The brand's own first sentence (`splitLede`), set under the metadata line. */
  lede?: string | null;
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
  omitProvenance = false,
  actionsSlot,
  adminSlot,
}: BrandHeaderProps) {
  const t = useTranslations("brandDetail");
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
          <Typography as="h1" balance variant="hero">
            {brand.name}
          </Typography>
          {adminSlot}
        </div>
        {metaParts.length > 0 ? (
          <p
            className="type-metadata animate-reveal-up"
            style={{ animationDelay: "100ms" }}
          >
            {metaParts.join(" · ")}
          </p>
        ) : null}
        {lede ? (
          <p
            className="type-lede animate-reveal-up"
            style={{ animationDelay: "200ms" }}
          >
            {lede}
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
}

/** Whether `BrandHeroFacts` renders anything for these props. */
export function hasBrandHeroFacts({
  cityLabel,
  foundingYear,
  selectedCount,
  stockistCount,
}: BrandHeroFactsProps): boolean {
  return Boolean(cityLabel) || foundingYear != null || selectedCount > 0 || stockistCount > 0;
}

/**
 * The lower half of the hero's info column (BD2-04, BD2-31): a provenance
 * colophon — the page's one bold typographic moment, city and founding year
 * set large in 明體 — then in-page jump rows to the sections that carry
 * counts. Static: no motion, surface, or shadow.
 */
export function BrandHeroFacts({
  cityLabel,
  foundingYear,
  selectedCount,
  stockistCount,
}: BrandHeroFactsProps) {
  const t = useTranslations("brandDetail");
  const hasColophon = Boolean(cityLabel) || foundingYear != null;
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
      ? [
          {
            href: "#where-to-buy",
            label: t("heroJump.stockists", { count: stockistCount }),
          },
        ]
      : []),
  ];
  if (!hasColophon && jumps.length === 0) return null;

  return (
    // With no colophon only the jump rows are left, and those are md-only.
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
      {jumps.length > 0 ? (
        // Below md the section-nav strip already indexes the page.
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
