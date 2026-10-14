import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import BrandMarquee from "@/components/landing/brand-marquee";
import { SectionBandCtaLink } from "@/components/landing/section-band-cta-link";
import { CONTROL_ICON, FOCUS_RING } from "@/components/ui/control-surface";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { routes } from "@/lib/routes";
import { displayBrandCount } from "@/lib/brands/display-brand-count";
import type { PublicBrandCard } from "@/lib/brands/contracts";
import { cn } from "@/lib/utils";

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
    <div>
      {/* The strip shows brands, so a brand's logo leads where one exists;
          the hero photo is the fallback (DS2-39). The count line is the
          strip's one link to the directory (DS-21): a separate browse-all
          link under the rail repeated the manifesto's 看品牌目錄 a screen
          later. The link keeps `actionLinkStyles`' accent, focus ring, and
          44px target but not that helper itself: its `type-nav` role would
          shrink the h2's `type-section` scale, which the link inherits. */}
      <BrandMarquee
        heading={
          <h2 className="type-section">
            <SectionBandCtaLink
              href={routes.brands()}
              label={
                <>
                  {/* ICU `select` keys are strings; next-intl's typed values reject a boolean. */}
                  {t("count", {
                    count: shown,
                    approximate: shown < totalCount ? "true" : "false",
                  })}
                  <ArrowRight aria-hidden="true" />
                </>
              }
              ctaName="browse_all"
              ctaLocation="homepage_brands"
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-control text-accent underline-offset-4 hover:underline",
                FOCUS_RING,
                CONTROL_ICON,
              )}
            />
          </h2>
        }
        brands={brands.map((brand) => {
          const logoSrc = safeImageSrc(brand.logoUrl);
          return {
            id: brand.id,
            name: brand.name,
            href: routes.brand(brand.slug),
            imageSrc: logoSrc ?? safeImageSrc(brand.heroImageUrl),
            isLogo: logoSrc !== null,
          };
        })}
      />
    </div>
  );
}
