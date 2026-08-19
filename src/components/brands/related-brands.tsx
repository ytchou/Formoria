import { getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { Typography } from "@/components/ui/typography";
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
      <section className="mt-16 border-t border-border pt-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <Typography as="h2" variant="sectionTitle">
              {t("relatedBrands.heading", { category: displayLabel })}
            </Typography>
            <p className="type-body-sm">
              {t("relatedBrands.subtext", { count })}
            </p>
          </div>
          <Link
            href={routes.category(category)}
            className="group inline-flex min-h-12 items-center gap-1.5 self-start type-body-sm font-medium text-accent transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
          >
            {displayLabel}
            <ChevronRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
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
