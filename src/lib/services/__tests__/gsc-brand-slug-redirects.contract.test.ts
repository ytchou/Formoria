import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", path), "utf8");

const migration = read("20261013150000_add_gsc_brand_slug_redirects.sql");
const reverse = read(
  "reverse/20261013150000_revert_add_gsc_brand_slug_redirects.sql",
);

// Old URL -> current slug. GSC (2026-10-13) reported these old URLs as 404.
const MAPPINGS = [
  ["facesun-玻璃工藝管", "facesun"],
  ["hh", "hh-healthy-happy"],
] as const;

describe("GSC brand slug redirects migration (DEV-2018)", () => {
  it("adds a redirect row for each renamed brand", () => {
    for (const [oldSlug, newSlug] of MAPPINGS) {
      expect(migration).toContain(`('${oldSlug}', '${newSlug}')`);
    }
  });

  it("only redirects to approved brands and is safe to re-run", () => {
    // A redirect to a hidden brand would 308 into a 404.
    expect(migration).toMatch(
      /JOIN brands ON brands\.slug = mappings\.new_slug\s+AND brands\.status = 'approved'/,
    );
    expect(migration).toContain("ON CONFLICT (old_slug) DO NOTHING");
    expect(migration).not.toMatch(/\b(UPDATE|DELETE)\b/);
  });

  it("reverse removes exactly the rows the migration adds", () => {
    for (const [oldSlug, newSlug] of MAPPINGS) {
      expect(reverse).toContain(`('${oldSlug}', '${newSlug}')`);
    }
    expect(reverse).toMatch(
      /DELETE FROM brand_slug_redirects\s+WHERE \(old_slug, new_slug\) IN/,
    );
  });
});
