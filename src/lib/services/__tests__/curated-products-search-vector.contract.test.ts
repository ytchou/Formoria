import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260930100000_product_search_vector_brand_name.sql"),
  "utf8",
);
const reverse = readFileSync(
  join(process.cwd(), "supabase/migrations/reverse/20260930100000_revert_product_search_vector_brand_name.sql"),
  "utf8",
);

describe("curated product search vector migration", () => {
  it("indexes brand names at B and stems Latin product and brand text", () => {
    expect(migration).toContain("p_brand_name text");
    expect(migration).toContain("p_brand_romanized text");
    expect(migration).toMatch(/setweight\([\s\S]*?p_brand_name[\s\S]*?, 'B'\)/);
    expect(migration).toContain("to_tsvector('english', coalesce(p_name_en, ''))");
    expect(migration).toContain("to_tsvector('simple', public.cjk_bigrams");
  });

  it("retouches products when their brand changes and when a brand is renamed", () => {
    expect(migration).toContain("subcategory, brand_id");
    expect(migration).toContain("after update of name, romanized_name on public.brands");
    expect(migration).toContain("old.name is distinct from new.name");
    expect(migration).toContain("old.romanized_name is distinct from new.romanized_name");
    expect(migration).toContain("p.brand_id = new.id");
    expect(migration).toContain("public.taxonomy_terms_retouch_product_search_vector()");
    expect(migration).toContain("b.name, b.romanized_name");
  });

  it("preserves updated_at for a derived search_vector write", () => {
    expect(migration).toContain("to_jsonb(new) - 'search_vector' - 'updated_at'");
    expect(migration).toContain("to_jsonb(old) - 'search_vector' - 'updated_at'");
    expect(migration).toContain("new.updated_at := old.updated_at");
  });

  it("revokes and asserts anon execute on every new or recreated function", () => {
    for (const signature of [
      "curated_products_set_updated_at()",
      "curated_products_search_document(text, text, text, text, text, text, text)",
      "curated_products_search_vector_update()",
      "taxonomy_terms_retouch_product_search_vector()",
      "brands_retouch_product_search_vector()",
    ]) {
      expect(migration).toContain(`revoke all on function public.${signature}`);
      expect(migration).toContain(`has_function_privilege('anon', 'public.${signature}'`);
    }
  });

  it("provides a reverse migration for the brand retouch trigger", () => {
    expect(reverse).toContain("drop trigger if exists brands_retouch_product_search_vector_trigger");
    expect(reverse).toContain("curated_products_search_document(text, text, text, text, text)");
    expect(reverse).toContain("execute function public.set_updated_at()");
  });
});
