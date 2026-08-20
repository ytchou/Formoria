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
