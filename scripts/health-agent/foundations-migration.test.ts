import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260722200000_github_health_agent_foundations.sql",
  ),
  "utf8",
).toLowerCase();

function functionSql(name: string) {
  const start = migration.indexOf(`create or replace function ${name}`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);

  const end = migration.indexOf("$$;", start);
  expect(end, `${name} must have a dollar-quoted body`).toBeGreaterThan(start);
  return migration.slice(start, end + 3);
}

describe("GitHub health agent foundation migration", () => {
  it("defines the complete repair state machine and stable active deduplication", () => {
    const expectedStates = [
      "pending",
      "claimed",
      "pr_opened",
      "awaiting_human",
      "merged",
      "deployed",
      "fixed",
      "failed",
      "skipped",
      "needs_human",
    ];

    for (const state of expectedStates) {
      expect(migration).toContain(`'${state}'`);
    }

    expect(migration).toMatch(/fingerprint\s+text/);
    expect(migration).toMatch(/check\s*\(btrim\(fingerprint\)\s*<>\s*''\)/);
    expect(migration).toContain(
      "drop index if exists health_fix_queue_active_issue_idx",
    );
    expect(migration).toMatch(
      /create unique index health_fix_queue_active_fingerprint_idx\s+on (?:public\.)?health_fix_queue \(fingerprint\)\s+where status in/,
    );
    expect(migration).toContain("sentry_issue_id drop not null");
  });

  it("claims every eligible row atomically and recovers expired leases", () => {
    const claim = functionSql("claim_health_fixes");

    expect(claim).toContain("for update skip locked");
    expect(claim).toContain("lease_expires_at <= now()");
    expect(claim).toContain("attempt_count < 2");
    expect(claim).not.toMatch(/\blimit\b/);
  });

  it("enforces compare-and-transition legality and two-attempt escalation", () => {
    const transition = functionSql("transition_health_fix");

    expect(transition).toContain("p_expected_status");
    expect(transition).toContain("invalid health fix transition");
    expect(transition).toMatch(/attempt_count\s*>=\s*2/);
    expect(transition).toContain("'needs_human'");
    expect(transition).toContain("p_next_attempt_at");
  });

  it("hardens every mutating function and removes public execution", () => {
    const functionNames = [
      "enqueue_health_fix",
      "claim_health_fixes",
      "transition_health_fix",
      "record_health_snapshot",
      "claim_health_agent_run",
      "complete_health_agent_run",
      "fail_health_agent_run",
      "record_link_health_result",
    ];

    for (const name of functionNames) {
      const sql = functionSql(name);
      expect(sql).toContain("security definer");
      expect(sql).toContain("set search_path = public, pg_temp");
      expect(migration).toMatch(
        new RegExp(`revoke all on function ${name}\\([^;]+from public`),
      );
    }
  });

  it("makes logical-day runs replayable while excluding dry runs from storage", () => {
    expect(migration).toContain("create table public.health_agent_run_ledger");
    expect(migration).toMatch(/unique\s*\(routine, logical_date\)/);

    const claim = functionSql("claim_health_agent_run");
    const dryRunGuard = claim.indexOf("if p_dry_run then");
    const insert = claim.indexOf("insert into public.health_agent_run_ledger");

    expect(dryRunGuard).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(dryRunGuard);
    expect(claim).toContain("status = 'completed'");
    expect(claim).toContain("result");
  });

  it("tracks distinct failure days and cleanup without touching brand data", () => {
    expect(migration).toMatch(/failure_dates\s+date\[\]/);
    expect(migration).toMatch(/distinct_failure_days\s+integer/);
    expect(migration).toMatch(/cleanup_required\s+boolean/);
    expect(migration).toMatch(/cleanup_required_at\s+timestamptz/);
    expect(migration).not.toMatch(/\bupdate\s+(?:public\.)?brands\s+set\b/);
    expect(migration).not.toMatch(/\binsert\s+into\s+(?:public\.)?brands\b/);
    expect(migration).not.toMatch(/\bdelete\s+from\s+(?:public\.)?brands\b/);
    expect(migration).not.toMatch(/auto_nulled_at\s*=/);

    const telemetry = functionSql("record_link_health_result");
    expect(telemetry).toContain("not (403, 429)");
    expect(telemetry).toContain("p_checked_at::date");
  });

  it("uses function-only writer grants and never grants brand writes", () => {
    expect(migration).toContain("create role health_agent_reader nologin");
    expect(migration).toContain("create role health_agent_writer nologin");
    expect(migration).toContain(
      "revoke all on all tables in schema public from health_agent_writer",
    );
    expect(migration).toMatch(
      /grant execute on function enqueue_health_fix\([^;]+to health_agent_writer/,
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)(?:\s*,\s*(?:insert|update|delete))*\s+on\s+(?:table\s+)?(?:public\.)?brands\s+to\s+health_agent_(?:reader|writer)/,
    );
    expect(migration).toContain(
      "revoke insert, update, delete on public.brands from health_agent_reader, health_agent_writer",
    );
  });
});
