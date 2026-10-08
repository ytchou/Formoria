import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import BrandMarquee from "@/components/landing/brand-marquee";
import { SectionBandCtaLink } from "@/components/landing/section-band-cta-link";
import { actionLinkStyles } from "@/components/ui/action-link";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { routes } from "@/lib/routes";
import { displayBrandCount } from "@/lib/brands/display-brand-count";
import type { PublicBrandCard } from "@/lib/brands/contracts";
type BrandStripProps = {
  brands: PublicBrandCard[];
  /** Exact directory-wide brand count; rounded here for display. */
  totalCount: number;
};

export default async function BrandStrip({
  brands,
  totalCount,
}: BrandStripProps) {
  const t = await getTranslations("landing.brands");
  const shown = displayBrandCount(totalCount);

  return (
    <div className="text-center">
      <h2 className="type-section">
        {/* ICU `select` keys are strings; next-intl's typed values reject a boolean. */}
        {t("count", {
          count: shown,
          approximate: shown < totalCount ? "true" : "false",
        })}
      </h2>

      <BrandMarquee
        brands={brands.map((brand) => ({
          id: brand.id,
          name: brand.name,
          href: routes.brand(brand.slug),
          imageSrc: safeImageSrc(brand.heroImageUrl),
        }))}
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
