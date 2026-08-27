import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import BrandMarquee from "@/components/landing/brand-marquee";
import { SectionBandCtaLink } from "@/components/landing/section-band-cta-link";
import { actionLinkStyles } from "@/components/ui/action-link";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { routes } from "@/lib/routes";
import type { PublicBrandCard } from "@/lib/brands/contracts";
type BrandStripProps = {
  brands: PublicBrandCard[];
  totalCount: number;
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

      <BrandMarquee
        brands={brands.map((brand) => ({
          id: brand.id,
          name: brand.name,
          href: routes.brand(brand.slug),
          imageSrc: safeImageSrc(brand.heroImageUrl),
        }))}
        labels={{ pause: t("pause"), resume: t("resume") }}
      />

      <SectionBandCtaLink
        href={routes.brands()}
        label={
          <>
            {t("browseAll")}
            <ArrowRight aria-hidden="true" />
          </>
        }
        ctaName="browse_all"
        ctaLocation="homepage_brands"
        className={actionLinkStyles({ className: "mt-6" })}
      />
    </div>
  );
}
