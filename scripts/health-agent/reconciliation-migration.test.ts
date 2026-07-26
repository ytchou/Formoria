import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260726234000_reconcile_health_fix_absence.sql",
  ),
  "utf8",
).toLowerCase();

const accessMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260727003500_revoke_reconcile_health_fix_public_access.sql",
  ),
  "utf8",
).toLowerCase();

describe("health fix absence reconciliation migration", () => {
  it("marks only unobserved active fingerprints fixed", () => {
    expect(migration).toContain(
      "create or replace function reconcile_health_fix_lifecycle",
    );
    expect(migration).toContain("p_observed_fingerprints text[]");
    expect(migration).toMatch(/status\s*=\s*'fixed'/);
    expect(migration).toContain(
      "not (queue.fingerprint = any (p_observed_fingerprints))",
    );
    expect(migration).toContain("'verification', 'detector_absence'");
    expect(migration).toContain("fixed_at = now()");
    expect(migration).toContain(
      "queue.fingerprint not like 'directory:canary:%'",
    );
    expect(migration).toContain("status = 'needs_human'");
    expect(migration).toContain("'detector_verification_failed'");
    expect(migration).toContain("'failed_verification'::text");
  });

  it("is scoped, hardened, and unavailable to public callers", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public, pg_temp");
    expect(migration).toContain(
      "revoke all on function reconcile_health_fix_lifecycle(text[]) from public",
    );
    expect(migration).not.toMatch(/\bdelete\s+from\b/);
  });

  it("revokes Supabase API roles while preserving agent execution", () => {
    expect(accessMigration).toContain(
      "from public, anon, authenticated",
    );
    expect(accessMigration).toContain(
      "to health_agent_writer, service_role",
    );
  });
});
