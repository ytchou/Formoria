import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { PublicBrandDetail } from "@/lib/brands/contracts";
import { buildBrandMetaLineParts } from "@/lib/brands/brand-meta-line";
import { Typography } from "@/components/ui/typography";

interface BrandHeaderProps {
  brand: PublicBrandDetail;
  categoryLabel?: string | null;
  cityLabel?: string | null;
  /** The brand's own first sentence (`splitLede`), set under the metadata line. */
  lede?: string | null;
  actionsSlot?: ReactNode;
  adminSlot?: ReactNode;
}

export function BrandHeader({
  brand,
  categoryLabel,
  cityLabel,
  lede,
  actionsSlot,
  adminSlot,
}: BrandHeaderProps) {
  const t = useTranslations("brandDetail");
  // One plain line instead of a labelled spec block (BD-11): an unknown part is
  // left out, never printed as a placeholder.
  const metaParts = buildBrandMetaLineParts({
    categoryLabel: categoryLabel ?? brand.categoryLabel,
    cityLabel,
    foundingYear: brand.foundingYear,
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
