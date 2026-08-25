import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { SurfaceImage } from "@/components/ui/image";
import { SectionBandCtaLink } from "@/components/landing/section-band-cta-link";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { routes } from "@/lib/routes";
import type { PublicBrandCard } from "@/lib/brands/contracts";
import type { Locale } from "@/lib/seo/alternates";

type BrandStripProps = {
  brands: PublicBrandCard[];
  totalCount: number;
  locale: Locale;
};

export default async function BrandStrip({
  brands,
  totalCount,
}: BrandStripProps) {
  const t = await getTranslations("landing.brands");

  return (
    <div className="text-center">
      <p className="type-body-lg font-ming">
        {t("count", { count: totalCount })}
      </p>

      <div className="mt-8 flex gap-6 overflow-x-auto scrollbar-none">
        {brands.map((brand) => {
          const src = safeImageSrc(brand.heroImageUrl);

          return (
            <Link
              key={brand.id}
              href={routes.brand(brand.slug)}
              className="flex shrink-0 flex-col items-center"
            >
              {src ? (
                <SurfaceImage
                  src={src}
                  alt={brand.name}
                  width={44}
                  height={44}
                  surface="thumb"
                  className="rounded-full"
                />
              ) : (
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-deep"
                  aria-hidden="true"
                >
                  <span className="type-metadata text-ink-soft">
                    {brand.name.charAt(0)}
                  </span>
                </div>
              )}
              <span className="mt-1 line-clamp-1 type-metadata text-ink-soft text-center">
                {brand.name}
              </span>
            </Link>
          );
        })}
      </div>

      <SectionBandCtaLink
        href={routes.brands()}
        label={t("browseAll")}
        ctaName="browse_all"
        ctaLocation="homepage_brands"
        className="mt-6 inline-block type-nav text-accent"
      />
    </div>
  );
}
