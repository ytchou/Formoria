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
            {/* No count here: the view-all link carries the one category
                total, and a second "others" count contradicted it. */}
            <p className="type-body-sm">
              {t("relatedBrands.subtext", { category: displayLabel })}
            </p>
          </div>
          <Link
            href={routes.brands({ category: category })}
            className={actionLinkStyles({
              className: "self-start sm:self-auto",
            })}
          >
            {t("relatedBrands.viewAll", { count, category: displayLabel })}
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
        {/* Below `sm` one horizontal snap row (cards at 85% so the next one
            peeks), so four cards no longer stack ~1,100px tall; only the row
            scrolls, never the page. From `sm` the shared card columns apply. */}
        <Grid className="*:snap-start max-sm:grid-flow-col max-sm:auto-cols-[85%] max-sm:grid-cols-none max-sm:overflow-x-auto max-sm:snap-x max-sm:snap-mandatory">
          {brands.map((brand, index) => (
            <BrandCard
              key={brand.id}
              brand={brand}
              variant="recommendation"
              sourceBrandSlug={currentBrandSlug}
              position={index}
              hideCategory
            />
          ))}
        </Grid>
      </section>
    </RelatedBrandsTracker>
  );
}
