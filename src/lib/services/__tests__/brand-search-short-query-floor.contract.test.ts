import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261008120000_brand_search_short_query_floor.sql",
  ),
  "utf8",
);
const reverse = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/reverse/20261008120000_revert_brand_search_short_query_floor.sql",
  ),
  "utf8",
);

describe("brand search short-query trigram floor migration (DEV-1970)", () => {
  it("creates an immutable floor helper granted like brand_trgm_rank", () => {
    expect(migration).toContain(
      "create or replace function public.brand_trgm_floor(p_query text)",
    );
    expect(migration).toMatch(/returns real\s+language sql\s+immutable\s+parallel safe/);
    expect(migration).toContain("~ '^(.)\\1*$'");
    expect(migration).toContain("char_length(btrim(p_query)) <= 4");
    expect(migration).toContain(
      "revoke all on function public.brand_trgm_floor(text)\n  from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "grant execute on function public.brand_trgm_floor(text)\n  to postgres, service_role;",
    );
  });

  it("patches both search RPCs in place through single-anchor replacements", () => {
    expect(migration).toContain("'      AND base.trgm_rank >= 0.25'");
    expect(migration).toContain(
      "'      AND base.trgm_rank >= public.brand_trgm_floor(sanitized_query)'",
    );
    expect(migration).toContain("'      ) >= 0.25'");
    expect(migration).toContain(
      "'      ) >= public.brand_trgm_floor(search_query)'",
    );
    expect(migration).toContain("pg_temp.patch_once(");
    expect(migration).not.toMatch(/drop function (if exists )?public\.search_/i);
    expect(migration).toContain(
      "drop function pg_temp.patch_once(text, text, text, text);",
    );
  });

  it("asserts the helper thresholds and the patched bodies inside the transaction", () => {
    for (const probe of [
      "brand_trgm_floor('zzzz') > 1",
      "brand_trgm_floor('aaaaaaa') > 1",
      "brand_trgm_floor(' Zz ') > 1",
      "brand_trgm_floor('zen') = 0.5",
      "brand_trgm_floor('lamp') = 0.5",
      "brand_trgm_floor('spring pool') = 0.25",
    ]) {
      expect(migration).toContain(probe);
    }
    expect(migration).toContain("pg_get_function_arguments(");
    expect(migration).toContain("has_function_privilege('service_role'");
  });

  it("provides a reverse migration that restores the 0.25 floor and drops the helper", () => {
    expect(reverse).toContain("'      AND base.trgm_rank >= 0.25'");
    expect(reverse).toContain("'      ) >= 0.25'");
    expect(reverse).toContain("drop function public.brand_trgm_floor(text);");
    expect(reverse).not.toMatch(/drop function (if exists )?public\.search_/i);
  });
});
