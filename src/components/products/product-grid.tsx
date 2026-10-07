import { Grid } from "@/components/ui/grid";
import type { CatalogProduct } from "@/lib/services/curated-products-catalog";
import { ProductCard } from "./product-card";

/**
 * Cards in the widest first row of the `catalog` grid
 * (`grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5`, ui/grid.tsx).
 * These load eagerly so the LCP image is never lazy. Sized to the widest
 * breakpoint, so narrower viewports eager-load a few below-the-fold cards —
 * cheaper than a lazy LCP. Change it with the `catalog` column count.
 */
const CATALOG_FIRST_ROW = 5;

type ProductGridProps = {
  products: CatalogProduct[];
  locale: string;
};

export function ProductGrid({ products, locale }: ProductGridProps) {
  return (
    <Grid as="ul" cols="catalog">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          locale={locale}
          imagePriority={
            index === 0
              ? "high"
              : index < CATALOG_FIRST_ROW
                ? "eager"
                : undefined
          }
        />
      ))}
    </Grid>
  );
}
