import type { CuratedProduct } from "@/lib/services/curated-products";
import { L2_SUBCATEGORIES } from "@/lib/taxonomy/ontology";

export type ProductRailGroup = {
  subcategory: string;
  products: CuratedProduct[];
};

export function groupProductsIntoRails(
  products: readonly CuratedProduct[],
): ProductRailGroup[] {
  const ontologyOrder = new Map(
    L2_SUBCATEGORIES.map((node, index) => [node.slug, index]),
  );
  const groups = new Map<string, CuratedProduct[]>();
  for (const product of products) {
    if (!product.subcategory) continue;
    const group = groups.get(product.subcategory) ?? [];
    group.push(product);
    groups.set(product.subcategory, group);
  }
  return [...groups.entries()]
    .map(([subcategory, rows]) => ({
      subcategory,
      products: rows.sort(
        (left, right) =>
          (left.productPosition ?? Number.MAX_SAFE_INTEGER) -
            (right.productPosition ?? Number.MAX_SAFE_INTEGER) ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.key.localeCompare(right.key),
      ),
    }))
    .sort(
      (left, right) =>
        right.products.length - left.products.length ||
        (ontologyOrder.get(left.subcategory) ?? Number.MAX_SAFE_INTEGER) -
          (ontologyOrder.get(right.subcategory) ?? Number.MAX_SAFE_INTEGER),
    );
}
