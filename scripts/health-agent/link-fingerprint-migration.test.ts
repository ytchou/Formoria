import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260727130100_canonicalize_link_health_fingerprints.sql",
  ),
  "utf8",
).toLowerCase();

describe("Link health fingerprint cleanup migration", () => {
  it("preserves history while retaining one canonical active row", () => {
    expect(migration).toContain("link:link-cleanup:");
    expect(migration).toContain("link:cleanup-required:");
    expect(migration).toContain("link:cleanup:");
    expect(migration).toContain("row_number() over");
    expect(migration).toContain("status = 'skipped'");
    expect(migration).toContain("superseded_by_canonical_link_owner");
    expect(migration).toContain("source = 'link'");
    expect(migration).not.toMatch(/\bdelete\s+from\b/);
  });
});
