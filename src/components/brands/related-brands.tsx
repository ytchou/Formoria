import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Typography } from "@/components/ui/typography";
import { actionLinkStyles } from "@/components/ui/action-link";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/locale-preference";
import type { PublicBrandCard } from "@/lib/brands/contracts";
import { BrandCard } from "./brand-card";
import { RelatedBrandsTracker } from "./related-brands-tracker";
import { routes } from "@/lib/routes";
import { Grid } from "@/components/ui/grid";

interface RelatedBrandsProps {
  locale: AppLocale;
  brands: PublicBrandCard[];
  category: string | null;
  categoryName: string;
  categoryLabel?: string | null;
  count: number;
  currentBrandSlug?: string;
}

export async function RelatedBrands({
  locale,
  brands,
  category,
  categoryLabel,
  categoryName,
  count,
  currentBrandSlug,
}: RelatedBrandsProps) {
  if (!category || brands.length === 0) return null;

  const t = await getTranslations({ locale, namespace: "brandDetail" });
  const displayLabel = categoryLabel ?? categoryName;

  return (
    <RelatedBrandsTracker
      sourceBrandSlug={currentBrandSlug ?? ""}
      count={count}
    >
      <section className="mt-section border-t border-rule pt-stack">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <Typography as="h2" variant="sectionTitleLarge">
              {t("relatedBrands.heading", { category: displayLabel })}
            </Typography>
            <p className="type-body-sm">
              {t("relatedBrands.subtext", { count })}
            </p>
          </div>
          <Link
            href={routes.category(category)}
            className={actionLinkStyles({
              className: "self-start sm:self-auto",
            })}
          >
            {displayLabel}
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
        <Grid>
          {brands.map((brand, index) => (
            <BrandCard
              key={brand.id}
              brand={brand}
              variant="recommendation"
              sourceBrandSlug={currentBrandSlug}
              position={index}
            />
          ))}
        </Grid>
      </section>
    </RelatedBrandsTracker>
  );
}
