/**
 * Contract test for the explore-brand-pool migration (DEV-1743).
 *
 * Reads the migration SQL as text and asserts that the signature, the
 * selection mechanism, the test-brand exclusion and the grants are present.
 * This is NOT an integration test — it never touches a database.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_FILE = "20260916110000_explore_brand_pool_rpc.sql";
const REVERSE_FILE = "20260916110000_revert_explore_brand_pool_rpc.sql";

function migrationPath(): string {
  return join(process.cwd(), "supabase", "migrations", MIGRATION_FILE);
}

function reversePath(): string {
  return join(
    process.cwd(),
    "supabase",
    "migrations",
    "reverse",
    REVERSE_FILE,
  );
}

function migrationText(): string {
  return readFileSync(migrationPath(), "utf8");
}

describe("get_explore_brand_pool migration contract", () => {
  it("declares the signature the TS caller invokes", () => {
    const sql = migrationText();
    expect(sql).toContain("create or replace function public.get_explore_brand_pool(");
    expect(sql).toContain("category_slugs text[]");
    expect(sql).toContain("per_category int");
    expect(sql).toContain("seed text");
    expect(sql).toContain(
      "returns table(brand_id uuid, brand_slug text, category text)",
    );
  });

  it("is a stable security-definer function with a pinned search_path", () => {
    const sql = migrationText();
    expect(sql).toContain("language sql");
    expect(sql).toContain("stable");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, extensions, pg_temp");
  });

  it("excludes e2e seed brands, which the rehydration path cannot", () => {
    const sql = migrationText();
    expect(sql).toContain("b.name not like '[E2E-TEST]%'");
  });

  it("selects approved brands in the requested categories only", () => {
    const sql = migrationText();
    expect(sql).toContain("b.status = 'approved'");
    expect(sql).toContain("b.category = any(category_slugs)");
  });

  it("caps per category by a seeded hash order, not by the table order", () => {
    const sql = migrationText();
    expect(sql).toContain("row_number() over (");
    expect(sql).toContain("partition by b.category");
    expect(sql).toContain("order by md5(b.id::text || seed)");
    expect(sql).toContain("where ranked.rn <= per_category");
  });

  it("returns identifiers only — no brand content columns", () => {
    const sql = migrationText();
    expect(sql).toContain("ranked.id as brand_id");
    expect(sql).toContain("ranked.slug as brand_slug");
    expect(sql).not.toMatch(/b\.description|b\.hero_image_url|b\.site_content/);
  });

  it("revokes anon and authenticated and grants service_role only", () => {
    const sql = migrationText();
    expect(sql).toContain(
      "revoke all on function public.get_explore_brand_pool(text[], int, text)",
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_explore_brand_pool\(text\[\], int, text\)[^;]*to\s+postgres,\s*service_role/i,
    );
  });

  it("documents the function", () => {
    expect(migrationText()).toContain(
      "comment on function public.get_explore_brand_pool",
    );
  });

  it("ships a reverse migration that drops the function", () => {
    expect(existsSync(reversePath())).toBe(true);
    const sql = readFileSync(reversePath(), "utf8");
    expect(sql).toContain(
      "drop function if exists public.get_explore_brand_pool(text[], int, text)",
    );
  });
});
