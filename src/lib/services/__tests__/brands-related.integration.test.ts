import { expect, it } from "vitest";
import { createTestClient, describeWithDb } from "@/test/setup";
import { getRelatedBrands } from "../brands";

describeWithDb("related brand browse results", () => {
  // Bug: the detail page issued separate queries that could disagree about whether the current brand counted as a sibling.
  it("when a visitor views a brand, related cards omit it and report the sibling category total", async () => {
    const supabase = createTestClient();
    const { data: candidates, error: candidatesError } = await supabase
      .from("brands")
      .select("slug, product_type")
      .eq("status", "approved")
      .not("name", "like", "[E2E-TEST]%")
      .not("product_type", "is", null)
      .order("product_type")
      .limit(5000);

    expect(candidatesError).toBeNull();

    const byCategory = new Map<string, string[]>();
    for (const candidate of candidates ?? []) {
      if (!candidate.product_type) continue;
      const slugs = byCategory.get(candidate.product_type) ?? [];
      slugs.push(candidate.slug);
      byCategory.set(candidate.product_type, slugs);
    }

    const categoryEntry = [...byCategory.entries()].find(
      ([, slugs]) => slugs.length >= 2,
    );
    expect(categoryEntry).toBeDefined();
    if (!categoryEntry) {
      throw new Error(
        "The test database must contain a category with at least two approved brands.",
      );
    }
    const [categorySlug, slugs] = categoryEntry;
    const currentSlug = slugs.at(0);
    if (!currentSlug) {
      throw new Error(
        "The selected category must contain a current brand slug.",
      );
    }

    const { count: siblingCount, error: countError } = await supabase
      .from("brands")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved")
      .not("name", "like", "[E2E-TEST]%")
      .eq("product_type", categorySlug)
      .neq("slug", currentSlug);

    expect(countError).toBeNull();

    const related = await getRelatedBrands(categorySlug, currentSlug, 4);

    expect(related.totalCount).toBe(siblingCount);
    expect(related.brands.every((brand) => brand.slug !== currentSlug)).toBe(
      true,
    );
    expect(related.brands.length).toBe(Math.min(4, siblingCount ?? 0));
  });
});
