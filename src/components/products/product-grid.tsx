import type { CatalogProduct } from "@/lib/services/curated-products-catalog";
import { ProductCard } from "./product-card";

type ProductGridProps = {
  products: CatalogProduct[];
  locale: string;
};

export function ProductGrid({ products, locale }: ProductGridProps) {
  return (
    <ul className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} locale={locale} />
      ))}
    </ul>
  );
}
