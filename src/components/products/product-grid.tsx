import { Grid } from "@/components/ui/grid";
import type { CatalogProduct } from "@/lib/services/curated-products-catalog";
import { ProductCard } from "./product-card";

type ProductGridProps = {
  products: CatalogProduct[];
  locale: string;
};

export function ProductGrid({ products, locale }: ProductGridProps) {
  return (
    <Grid as="ul" cols="catalog">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} locale={locale} />
      ))}
    </Grid>
  );
}
