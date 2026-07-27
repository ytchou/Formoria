import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260727130000_unify_health_lifecycle.sql",
  ),
  "utf8",
).toLowerCase();

describe("health fix absence reconciliation migration", () => {
  it("marks only unobserved active fingerprints fixed", () => {
    expect(migration).toContain(
      "create function public.reconcile_health_fix_lifecycle",
    );
    expect(migration).toContain("p_observed_fingerprints text[]");
    expect(migration).toContain("p_completed_sources text[]");
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
    expect(migration).toContain("'regressed'::text");
    expect(migration).toContain("'verified_sentry_absence'::text");
    expect(migration).toContain("and queue.source <> 'sentry'");
    expect(migration).toContain("queue.source = any (p_completed_sources)");
  });

  it("is scoped, hardened, and unavailable to public callers", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public, pg_temp");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).not.toMatch(/\bdelete\s+from\b/);
  });

  it("revokes Supabase API roles while preserving agent execution", () => {
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to health_agent_writer");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("legacy_sentry_row_missing_provider_id");
    expect(migration).toContain("legacy_dead_tuple_threshold_false_positive");
  });
});
