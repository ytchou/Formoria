/**
 * Query the curated product catalog and print candidate brand/product
 * pairs for the golden set.
 *
 * Usage: pnpm exec tsx scripts/search-eval/generate-golden-candidates.ts --target staging
 */
import { loadScriptTarget } from "../shared/target";
import { getPublishedCuratedProducts } from "@/lib/services/curated-products-catalog";

async function main(): Promise<void> {
  loadScriptTarget();

  const { products } = await getPublishedCuratedProducts({ pageSize: 2000 });

  // Group by category, then by brand
  const byCategory = new Map<
    string,
    Array<{
      brandSlug: string;
      key: string;
      nameZh: string;
      brandName: string;
      subcategory: string;
    }>
  >();

  for (const p of products) {
    const cat = p.category || "uncategorized";
    const list = byCategory.get(cat) ?? [];
    list.push({
      brandSlug: p.brandSlug,
      key: p.key,
      nameZh: p.nameZh,
      brandName: p.brandName,
      subcategory: p.subcategory,
    });
    byCategory.set(cat, list);
  }

  console.log(`Total products: ${products.length}`);
  console.log(
    `Categories: ${[...byCategory.keys()].sort().join(", ")}\n`,
  );

  for (const [category, items] of [...byCategory.entries()].sort()) {
    console.log(`\n## ${category} (${items.length} products)`);
    // Group by brand within category
    const byBrand = new Map<string, typeof items>();
    for (const item of items) {
      const list = byBrand.get(item.brandSlug) ?? [];
      list.push(item);
      byBrand.set(item.brandSlug, list);
    }
    for (const [, brandItems] of [...byBrand.entries()].sort()) {
      for (const item of brandItems) {
        console.log(
          `  ${item.brandSlug} / ${item.key} — ${item.nameZh} (${item.subcategory})`,
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
