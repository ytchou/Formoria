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
      <div className="mx-auto grid max-w-[1280px] items-center gap-gutter md:grid-cols-[minmax(0,0.85fr)_minmax(320px,1fr)] md:gap-12">
        <div className="space-y-stack">
          <div className="space-y-3">
            <h1 className="type-page-title">{brand.name}</h1>
            {siteContent.tagline && (
              <p className="max-w-2xl type-body">{siteContent.tagline}</p>
            )}
          </div>

          {/*
            The BRAND's accent, not the system's — see `tokens.ts`. The label
            colour is set inline rather than through an arbitrary-value colour
            utility wrapping the CSS variable, because `type-button` carries
            `text-ink` of its own and two single-class colour rules leave CSS
            source order to decide which one a brand's CTA gets.

            Do not write that utility's class name out here, even as an
            example: Tailwind scans comments for candidates, so naming it
            generates a rule with a literal ellipsis in it, which fails to
            parse and 500s every route in the app.

            The focus ring is the brand accent held off the fill by a 2px
            ground offset, which is exactly how the system `Button` draws a
            ring on top of `bg-accent`.
          */}
          <a
            href="#contact"
            className="inline-flex min-h-11 items-center justify-center rounded-[4px] bg-[var(--brand-accent)] px-6 type-button transition-transform focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none active:scale-[0.98] motion-reduce:transition-none"
            style={{ color: "var(--brand-accent-foreground)" }}
          >
            了解更多
          </a>
        </div>

        {brand.heroImageUrl && (
          <div className="relative aspect-media overflow-hidden rounded-[3px] border border-rule bg-surface">
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
