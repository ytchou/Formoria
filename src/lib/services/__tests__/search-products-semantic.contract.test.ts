/**
 * Contract test for the situation-search migration (DEV-1680 Task 5).
 *
 * Reads the migration SQL as text and asserts that critical signatures,
 * bounds, grants, and view gates are present. This is NOT an integration
 * test — it never touches a database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_FILE = "20260903100200_situation_search.sql";
const POOL_MIGRATION_FILE = "20260915140000_situation_search_pool_100.sql";
const POOL_REVERSE_FILE = "20260915140000_revert_situation_search_pool.sql";
const AMBIGUITY_FIX_FILE =
  "20260916103000_fix_situation_search_product_id_ambiguity.sql";

function migrationText(): string {
  return readFileSync(
    join(process.cwd(), "supabase", "migrations", MIGRATION_FILE),
    "utf8",
  );
}

function poolMigrationText(): string {
  return readFileSync(
    join(process.cwd(), "supabase", "migrations", POOL_MIGRATION_FILE),
    "utf8",
  );
}

function poolReverseText(): string {
  return readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "reverse",
      POOL_REVERSE_FILE,
    ),
    "utf8",
  );
}

function ambiguityFixText(): string {
  return readFileSync(
    join(process.cwd(), "supabase", "migrations", AMBIGUITY_FIX_FILE),
    "utf8",
  );
}

describe("situation_search migration contract", () => {
  it("search_products_semantic signature matches the design", () => {
    const sql = migrationText();
    expect(sql).toContain(
      "search_products_semantic(query_text text, query_embedding extensions.vector, mode text, match_count integer, filter_category text, filter_subcategories text[], filter_materials text[])",
    );
  });

  it("RPC bounds match_count to 100 and rejects unknown modes", () => {
    const sql = poolMigrationText();
    expect(sql).toContain("least(greatest(match_count, 1), 100)");
    expect(sql).toContain("limit 100");
    expect(sql).toContain("situation_search_lexical(query_text, 100)");
    expect(sql).toContain("mode not in ('vector','lexical','hybrid')");
  });

  it("pool migration keeps the RPC signature", () => {
    const sql = poolMigrationText();
    expect(sql).toContain(
      "search_products_semantic(query_text text, query_embedding extensions.vector, mode text, match_count integer, filter_category text, filter_subcategories text[], filter_materials text[])",
    );
  });

  it("qualifies the eligible product id inside the PL/pgSQL return query", () => {
    const sql = ambiguityFixText();
    expect(sql).toContain(
      "select eligible_product.product_id from eligible eligible_product",
    );
    expect(sql).not.toContain("select product_id from eligible)");
  });

  it("taxonomy rename trigger is column-scoped, change-gated, and service-role only", () => {
    const sql = poolMigrationText();
    expect(sql).toContain(
      "after update of name_zh on public.taxonomy_terms",
    );
    expect(sql).toContain(
      "when (old.name_zh is distinct from new.name_zh)",
    );
    expect(sql).toContain(
      "revoke all on function public.taxonomy_terms_retouch_product_search_vector",
    );
    const grantPattern =
      /grant execute[^;]*taxonomy_terms_retouch_product_search_vector[^;]*to[^;]*postgres,\s*service_role/i;
    expect(sql).toMatch(grantPattern);
  });

  it("reverse migration restores the 48 clamp and drops the trigger", () => {
    const sql = poolReverseText();
    expect(sql).toContain("least(greatest(match_count, 1), 48)");
    expect(sql).toContain("limit 50");
    expect(sql).toContain("situation_search_lexical(query_text, 50)");
    expect(sql).toContain(
      "drop trigger if exists taxonomy_terms_retouch_product_search_vector_trigger",
    );
  });

  it("all three functions revoke anon and authenticated by name and grant service_role", () => {
    const sql = migrationText();

    const functions = [
      "situation_query_bigrams",
      "situation_search_lexical",
      "search_products_semantic",
    ];

    for (const fn of functions) {
      // Each function must have a revoke and a grant
      expect(sql).toContain(`revoke all on function public.${fn}`);
      expect(sql).toContain(
        `grant execute on function public.${fn}`,
      );
    }

    // Verify service_role is the grant target
    for (const fn of functions) {
      const grantPattern = new RegExp(
        `grant execute on function public\\.${fn}[^;]*to[^;]*service_role`,
        "i",
      );
      expect(sql).toMatch(grantPattern);
    }
  });

  it("view excludes hidden brands, demo brands, invisible and unsourced products", () => {
    const sql = migrationText();
    expect(sql).toContain("b.status = 'approved'");
    expect(sql).toContain("not b.is_demo");
    expect(sql).toContain("p.visible");
    expect(sql).toContain("p.official_url is not null");
    expect(sql).toContain("p.source_checked_at is not null");
    expect(sql).toContain("exists (select 1 from curated_product_sources");
  });

  it("view is service-role only", () => {
    const sql = migrationText();
    expect(sql).toContain(
      "revoke all on public.product_embedding_documents from PUBLIC, anon, authenticated",
    );
    expect(sql).toContain(
      "grant select on public.product_embedding_documents to service_role",
    );
  });
});
