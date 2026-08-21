import { SurfaceImage } from "@/components/ui/image";
import { surfaceCardStyles } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import type {
  PublicMicrositeBrand,
  PublicSiteProduct,
} from "@/lib/brands/contracts";

type ProductGridProps = {
  brand: PublicMicrositeBrand;
  products: PublicSiteProduct[];
};

export function ProductGrid({ brand, products }: ProductGridProps) {
  if (products.length === 0) {
    return null;
  }

  return (
    <section className="py-12 md:py-16" aria-labelledby="microsite-products">
      {/* Gutter and measure both from the shell — see `hero.tsx`. */}
      <PageShell measure="page" className="space-y-stack">
        <h2 id="microsite-products" className="type-section">
          精選商品
        </h2>

        <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <article
              key={`${product.name}-${product.url ?? product.imageUrl ?? "product"}`}
              className={surfaceCardStyles({
                // No lift. v2's elevation is the rule the card already draws;
                // `interactive` moves that rule to ink on hover, which is the
                // whole affordance.
                className: "group overflow-hidden",
                interactive: true,
                padding: "none",
              })}
            >
              {product.imageUrl && (
                <div className="relative aspect-media overflow-hidden rounded-t-[3px] bg-surface-deep">
                  <SurfaceImage
                    src={product.imageUrl}
                    alt={`${brand.name} ${product.name}`}
                    fill
                    className="object-cover transition-transform group-hover:scale-[1.02] motion-reduce:transition-none"
                    surface="tile"
                  />
                </div>
              )}

              <div className="space-y-gutter p-5">
                <div className="space-y-1.5">
                  <h3 className="type-card-title">{product.name}</h3>
                  {product.caption && (
                    <p className="type-metadata">{product.caption}</p>
                  )}
                </div>

                {product.url && (
                  <a
                    href={product.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-[4px] border border-rule px-4 type-button transition-colors hover:border-[var(--brand-accent)] hover:text-[var(--brand-accent)] focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none active:scale-[0.98] motion-reduce:transition-none"
                  >
                    查看商品
                    {/*
                      Extends the visible label rather than replacing it: read
                      aloud, a grid of twelve products is otherwise twelve
                      links all called 查看商品, and the destination is off-site.
                    */}
                    <span className="sr-only">：{product.name}（外部連結）</span>
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </PageShell>
    </section>
  );
}
