import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { PublicBrandDetail } from "@/lib/brands/contracts";
import { getBrandSubcategoryLabels } from "@/lib/brands/category-label";
import { Badge } from "@/components/ui/badge";
import { InfoField } from "@/components/ui/card";
import { Grid } from "@/components/ui/grid";
import { Typography } from "@/components/ui/typography";
import { CorrectionDialog } from "./correction-dialog";

const infoLabelClassName = "type-metadata uppercase tracking-[0.08em]";

interface BrandHeaderProps {
  brand: PublicBrandDetail;
  categoryLabel?: string | null;
  cityLabel?: string | null;
  locale?: string;
  actionsSlot?: ReactNode;
  adminSlot?: ReactNode;
}

export function BrandHeader({
  brand,
  categoryLabel,
  cityLabel,
  locale,
  actionsSlot,
  adminSlot,
}: BrandHeaderProps) {
  const t = useTranslations("brandDetail");
  const resolvedCategory = categoryLabel ?? brand.categoryLabel;
  // `subcategories` stores slugs since DEV-1510, so the chips resolve through
  // the ontology rather than rendering the stored value.
  const resolvedTags = getBrandSubcategoryLabels(brand, locale ?? "zh-TW");
  const unknownValue = (
    <Typography as="span" className="text-ink-muted" variant="fieldValue">
      {t("unknown")}
    </Typography>
  );

  return (
    <div>
      <div className="space-y-3">
        {/* Brand name. The page title step of the content face: this is the one
            piece of copy the whole page is about, and it is the brand's own
            name, not interface chrome. */}
        <div className="flex items-start justify-between gap-4">
          <Typography as="h1" balance variant="pageTitleLarge">
            {brand.name}
          </Typography>
          {adminSlot}
        </div>

        {/* CTA slot — rendered between name and meta row */}
        {actionsSlot}
      </div>

      <section
        aria-labelledby="brand-info-heading"
        id="brand-info-section"
        className="mt-7"
      >
        <div className="flex items-center justify-between gap-4">
          <Typography
            as="h2"
            id="brand-info-heading"
            variant="sectionTitleLarge"
          >
            {t("sectionTitle")}
          </Typography>
          <CorrectionDialog
            brandId={brand.id}
            brandSlug={brand.slug}
            categorySlug={brand.categorySlug ?? null}
            subcategories={brand.subcategories}
          />
        </div>
        <Grid as="dl" cols="pair" className="mt-5">
          <InfoField
            label={t("label.location")}
            labelClassName={infoLabelClassName}
            layout="stacked"
            value={
              cityLabel ? (
                <Badge className="text-ink" variant="secondary">
                  {cityLabel}
                </Badge>
              ) : (
                unknownValue
              )
            }
          />
          <InfoField
            label={t("label.foundingYear")}
            labelClassName={infoLabelClassName}
            layout="stacked"
            value={
              brand.foundingYear != null ? (
                <Badge className="text-ink" variant="secondary">
                  {brand.foundingYear}
                </Badge>
              ) : (
                unknownValue
              )
            }
          />
          <InfoField
            label={t("label.category")}
            labelClassName={infoLabelClassName}
            layout="stacked"
            value={
              resolvedCategory ? (
                <Badge className="text-ink" variant="secondary">
                  {resolvedCategory}
                </Badge>
              ) : (
                unknownValue
              )
            }
          />
          <InfoField
            label={t("label.subcategories")}
            labelClassName={infoLabelClassName}
            layout="stacked"
            value={
              resolvedTags.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {resolvedTags.map((tag, index) => (
                    <Badge
                      key={`${tag}-${index}`}
                      className="text-ink"
                      variant="secondary"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : (
                unknownValue
              )
            }
          />
        </Grid>
      </section>
    </div>
  );
}
