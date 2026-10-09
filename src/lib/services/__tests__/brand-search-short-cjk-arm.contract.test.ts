import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261009120000_brand_search_short_cjk_arm.sql",
  ),
  "utf8",
);
const reverse = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/reverse/20261009120000_revert_brand_search_short_cjk_arm.sql",
  ),
  "utf8",
);

const noDescription = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261009130000_brand_search_short_cjk_no_description.sql",
  ),
  "utf8",
);
const noDescriptionReverse = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/reverse/20261009130000_revert_brand_search_short_cjk_no_description.sql",
  ),
  "utf8",
);

const CJK_CLASS = "[㐀-䶿一-鿿豈-﫿]";

describe("brand search short-CJK ILIKE arm migration (DEV-1991)", () => {
  it("lets a single CJK character past the search_brand_page length floor", () => {
    expect(migration).toContain("'    OR char_length(normalized_query) < 2'");
    expect(migration).toContain(`AND normalized_query !~ '${CJK_CLASS}'`);
  });

  it("adds an ILIKE arm to search_brand_page ranked by field", () => {
    expect(migration).toContain("AS ilike_rank");
    expect(migration).toContain("has_cjk AND char_length(sanitized_query) <= 2");
    for (const field of ["b.name", "b.romanized_name", "b.blurb", "b.description"]) {
      expect(migration).toContain(`${field} ILIKE '%' || sanitized_query || '%'`);
    }
    for (const rank of ["1.0::real", "0.6::real", "0.3::real"]) {
      expect(migration).toContain(rank);
    }
    expect(migration).toContain("'ilike'::text AS search_source");
    // Rows the ILIKE arm admits leave the fts arm, so no id appears twice.
    expect(migration).toContain("'    WHERE base.has_fts'");
    expect(migration).toContain("    WHERE base.has_fts AND base.ilike_rank = 0");
    expect(migration).toContain("WHERE base.ilike_rank > 0");
  });

  it("adds a capped, de-duplicated ILIKE fallback to search_brands", () => {
    expect(migration).toContain(
      "'  IF tsq IS NULL AND prefix_mode THEN RETURN; END IF;'",
    );
    expect(migration).toContain("ilike_results AS (");
    expect(migration).toContain(
      "NOT EXISTS (SELECT 1 FROM fts_results AS f WHERE f.id = b.id)",
    );
    expect(migration).toContain("search_query !~ '[%_\\\\]'");
    expect(migration).toContain("AND b.status = filter_status");
    expect(migration).toContain("AND (include_test_brands OR b.is_demo IS NOT TRUE)");
    expect(migration).toContain("SELECT * FROM ilike_results;");
    expect(migration).toContain("result_limit - (SELECT count(*) FROM fts_results)");
  });

  it("patches in place, pins the contract and cleans up", () => {
    expect(migration).toContain("pg_temp.patch_once(");
    expect(migration).toContain("pg_temp.dev1991_contract(");
    expect(migration).not.toMatch(/drop function (if exists )?public\.search_/i);
    expect(migration).toContain("has_function_privilege('service_role'");
    expect(migration).toContain("pg_get_function_arguments(");
    expect(migration).toContain(
      "drop function pg_temp.patch_once(text, text, text, text);",
    );
    expect(migration).toContain(
      "drop function pg_temp.dev1991_contract(regprocedure);",
    );
    expect(migration).toMatch(/^begin;$/m);
    expect(migration).toMatch(/^commit;$/m);
  });

  it("provides a reverse migration that removes both arms", () => {
    expect(reverse).toContain("pg_temp.patch_once(");
    expect(reverse).toContain("'    OR char_length(normalized_query) < 2'");
    expect(reverse).toContain("'    WHERE base.has_fts'");
    expect(reverse).toContain(
      "'  IF tsq IS NULL AND prefix_mode THEN RETURN; END IF;'",
    );
    expect(reverse).toContain("  SELECT * FROM trgm_results;");
    expect(reverse).not.toMatch(/drop function (if exists )?public\.search_/i);
    expect(reverse).toContain(
      "drop function pg_temp.patch_once(text, text, text, text);",
    );
  });

  it("answers a 1-character CJK query from name, romanized name and blurb only (R2-13)", () => {
    // The fts arm's prefix tsquery ('包':*) reaches description lexemes.
    expect(noDescription).toContain(
      "AND NOT (has_cjk AND char_length(sanitized_query) = 1)",
    );
    expect(noDescription).toContain(
      "AND NOT (has_cjk AND char_length(search_query) = 1)",
    );
    // The description branch stays for 2-character queries.
    expect(noDescription).toContain(
      "WHEN char_length(sanitized_query) = 2\n              AND b.description ILIKE",
    );
    expect(noDescription).toContain(
      "OR (char_length(search_query) = 2\n          AND b.description ILIKE",
    );
    expect(noDescription).toContain("pg_temp.dev1991_contract(");
    expect(noDescription).not.toMatch(/drop function (if exists )?public\.search_/i);
    for (const label of [
      "search_brand_page description branch",
      "search_brand_page fts arm single-character skip",
      "search_brands description disjunct",
      "search_brands fts single-character skip",
    ]) {
      expect(noDescriptionReverse).toContain(`'${label}'`);
    }
  });
});
