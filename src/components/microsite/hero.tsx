import { MicrositeCta } from "@/components/microsite/microsite-cta";
import { SurfaceImage } from "@/components/ui/image";
import { PageShell } from "@/components/ui/page-shell";
import type { PublicMicrositeBrand } from "@/lib/brands/contracts";
import { brandImageFill } from "@/lib/images/fill";

type HeroProps = {
  brand: PublicMicrositeBrand;
  siteContent: Pick<PublicMicrositeBrand["siteContent"], "tagline">;
};

export function Hero({ brand, siteContent }: HeroProps) {
  const heroFill = brandImageFill(brand.heroImageMeta, { inset: "p-6" });

  return (
    /*
      THE MICROSITE IS ON THE SAME MEASURE AS THE REST OF THE PRODUCT.

      Every band here used to pair a hand-written horizontal padding on the
      section with a hand-written 1280px cap on the child — the gutter and the
      measure, spelled out by hand in all five files. The 1280px was never its
      own decision: it was
      the 80rem the rest of the site was on, wearing a pixel value that no
      stylesheet edit could reach. `PageShell` now owns both, so the horizontal
      padding lives on the same element as the cap it frames, and the band
      picks up the wide gutter's third step at 1280px like every other page.
    */
    <section className="pt-12 md:pt-16">
      <PageShell
        measure="page"
        className="grid items-center gap-gutter md:grid-cols-[minmax(0,0.85fr)_minmax(320px,1fr)] md:gap-12"
      >
        <div className="space-y-stack">
          <div className="space-y-3">
            <h1 className="type-page-title">{brand.name}</h1>
            {siteContent.tagline && (
              <p className="prose-measure type-body">{siteContent.tagline}</p>
            )}
          </div>

          {/* The BRAND's accent, not the system's — the fill, the label colour
              and the focus ring all live in `microsite-cta.tsx`. */}
          <MicrositeCta href="#contact">了解更多</MicrositeCta>
        </div>

        {brand.heroImageUrl && (
          <div className="relative aspect-media overflow-hidden rounded-[3px] border border-rule bg-surface">
            <SurfaceImage
              src={brand.heroImageUrl}
              alt={brand.name}
              fill
              // Shared with every other brand image surface: a logo is
              // contained (its whitespace is part of the mark), everything else
              // covers. The container above already paints the plate a
              // contained logo sits on.
              className={heroFill}
              surface="split"
              preload
            />
          </div>
        )}
      </PageShell>
    </section>
  );
}
