import { SurfaceImage } from "@/components/ui/image";
import type { PublicMicrositeBrand } from "@/lib/brands/contracts";
import { brandImageFill } from "@/lib/images/focal";

type HeroProps = {
  brand: PublicMicrositeBrand;
  siteContent: Pick<PublicMicrositeBrand["siteContent"], "tagline">;
};

export function Hero({ brand, siteContent }: HeroProps) {
  const heroFill = brandImageFill(brand.heroImageMeta, { inset: "p-6" });

  return (
    <section className="px-6 pt-12 md:px-10 md:pt-16">
      <div className="mx-auto grid max-w-[1280px] items-center gap-8 md:grid-cols-[minmax(0,0.85fr)_minmax(320px,1fr)] md:gap-12">
        <div className="space-y-5">
          <div className="space-y-3">
            <h1 className="type-section">{brand.name}</h1>
            {siteContent.tagline && (
              <p className="max-w-2xl type-body-sm">{siteContent.tagline}</p>
            )}
          </div>

          <a
            href="#contact"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--brand-accent)] px-6 py-3 type-body-sm font-semibold text-ink text-[var(--brand-accent-foreground)] transition-transform active:scale-[0.98]"
          >
            了解更多
          </a>
        </div>

        {brand.heroImageUrl && (
          <div className="relative aspect-media overflow-hidden rounded-xl border border-border bg-card">
            <SurfaceImage
              src={brand.heroImageUrl}
              alt={brand.name}
              fill
              // Shared with every other brand image surface: a logo is
              // contained (its whitespace is part of the mark), everything else
              // covers and is anchored on its focal point. The container above
              // already paints the plate a contained logo sits on.
              className={heroFill.className}
              // Assigned, never spread — `undefined` is meaningful here.
              style={heroFill.style}
              surface="split"
              preload
            />
          </div>
        )}
      </div>
    </section>
  );
}
