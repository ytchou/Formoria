import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260727150000_bound_health_fix_claims.sql",
  ),
  "utf8",
).toLowerCase();

describe("bounded health fix claim migration", () => {
  it("claims only explicitly requested fingerprints and removes the policy-wide overload", () => {
    expect(migration).toContain(
      "drop function if exists public.claim_health_fixes(text, text, interval)",
    );
    expect(migration).toMatch(
      /create function public\.claim_health_fixes\(\s*p_merge_policy text,\s*p_lease_owner text,\s*p_fingerprints text\[\]/,
    );
    expect(migration).toMatch(
      /queue\.fingerprint\s*=\s*any\s*\(p_fingerprints\)/,
    );
    expect(migration).toContain("p_fingerprints is null");
    expect(migration).toContain("cardinality(p_fingerprints) = 0");
    expect(migration).toContain("p_merge_policy is null");
    expect(migration).toContain("p_lease_owner is null");
    expect(migration).toContain("p_lease_duration is null");
  });

  it("keeps the bounded claim RPC private to scoped health roles", () => {
    expect(migration).toMatch(
      /revoke all on function public\.claim_health_fixes\(text, text, text\[\], interval\)\s+from public, anon, authenticated/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.claim_health_fixes\(text, text, text\[\], interval\)\s+to health_agent_writer/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.claim_health_fixes\(text, text, text\[\], interval\)\s+to service_role/,
    );
  });
});
