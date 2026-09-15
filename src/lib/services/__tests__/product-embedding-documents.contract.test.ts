/**
 * Contract test for the product_embedding_documents view (DEV-1733).
 *
 * Reads the migration SQL as text and asserts that critical properties hold:
 * eligibility gates, access grants, material-gate alignment with the ontology,
 * NULL-when-empty semantics, and field order stability. This is NOT an
 * integration test -- it never touches a database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MATERIAL_APPLICABLE_CATEGORIES } from "@/lib/taxonomy/ontology";

const MIGRATION_FILE =
  "20260915130000_embedding_document_materials.sql";

function migrationText(): string {
  return readFileSync(
    join(process.cwd(), "supabase", "migrations", MIGRATION_FILE),
    "utf8",
  );
}

describe("product_embedding_documents view contract", () => {
  it("view keeps the six eligibility gates", () => {
    const sql = migrationText();
    expect(sql).toContain("b.status = 'approved'");
    expect(sql).toContain("not b.is_demo");
    expect(sql).toContain("p.visible");
    expect(sql).toContain("p.official_url is not null");
    expect(sql).toContain("p.source_checked_at is not null");
    expect(sql).toContain(
      "exists (select 1 from curated_product_sources",
    );
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

  it("material gate matches MATERIAL_APPLICABLE_CATEGORIES exactly", () => {
    const sql = migrationText();

    // Parse the category list from the SQL: p.category in ('home','fashion',...)
    const inClauseMatch = sql.match(/p\.category in \(([^)]*)\)/);
    expect(inClauseMatch).not.toBeNull();

    const slugMatches = inClauseMatch![1].matchAll(/'([a-z-]+)'/g);
    const sqlCategories = [...slugMatches].map((m) => m[1]).sort();

    const ontologyCategories = [...MATERIAL_APPLICABLE_CATEGORIES].sort();

    expect(sqlCategories).toEqual(ontologyCategories);
  });

  it("material line is NULL when empty and joins the material axis", () => {
    const sql = migrationText();
    expect(sql).toContain("nullif(");
    expect(sql).toContain("t.axis = 'material'");
  });

  it("document field order is stable", () => {
    const sql = migrationText();

    // The concat_ws block must contain the seven fields in this exact order
    const concatBlock = sql.match(/concat_ws\(\s*chr\(10\)([\s\S]*?)\) as document_text/);
    expect(concatBlock).not.toBeNull();

    const body = concatBlock![1];

    // Assert order: each field appears after the previous one
    const fields = [
      "b.name",
      "b.blurb",
      "l1.name_zh",
      "l2.name_zh",
      "p.name_zh",
      "p.product_description_zh",
      "case",
    ];

    let lastIndex = -1;
    for (const field of fields) {
      const idx = body.indexOf(field);
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }

    // Verify the case block contains the category gate
    expect(body).toContain("when p.category in");
  });
});
