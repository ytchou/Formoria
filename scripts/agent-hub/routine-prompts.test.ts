import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const activePromptPath = "docs/routines/formoria-health-prompt.md";
const archivePath =
  "docs/routines/archive/formoria-health-prompt-claude-routine.md";
const configurationPath = "docs/routines/cloud-routine-configuration.md";

/**
 * DEV-1389 untracked all of `docs/`. These three fixtures are deliberately
 * local-only — they are internal ops content, and publishing them is precisely
 * what that ticket removed. They exist in a working checkout and are absent in
 * CI, so the contract below can only be enforced where the prompts live.
 *
 * Do NOT "fix" this by re-tracking the files, and do not swap the skip for a
 * silent empty-input guard. An ungated `readFile` here passed locally forever
 * and would have gone red only on a fresh clone — `skipIf` reports "not
 * checked" out loud instead of reporting a pass it did not earn.
 */
const hasRoutineFixtures =
  existsSync(activePromptPath) &&
  existsSync(archivePath) &&
  existsSync(configurationPath);

describe.skipIf(!hasRoutineFixtures)("Formoria health-agent retirement contract (local docs/routines fixtures)", () => {
  it("keeps a no-op tombstone and a complete historical archive", async () => {
    const [tombstone, archive] = await Promise.all([
      readFile(activePromptPath, "utf8"),
      readFile(archivePath, "utf8"),
    ]);

    expect(tombstone).toContain("intentionally a no-op");
    expect(tombstone).toContain(".github/workflows/health-agent.yml");
    expect(tombstone).toContain(archivePath.split("docs/routines/")[1]);
    expect(tombstone).toContain("rollback gate");
    expect(archive).toContain(
      "# Formoria Health Agent — Unified Daily Routine Prompt",
    );
    expect(archive.length).toBeGreaterThan(tombstone.length);
  });

  it("assigns active ownership to GitHub Actions and only three collectors", async () => {
    const tombstone = await readFile(activePromptPath, "utf8");
    const collectorNames = [
      ...tombstone.matchAll(/`(link-checker|directory-health|sentry-triage)`/g),
    ].map((match) => match[1]);

    expect(tombstone).toContain("GitHub Actions owns");
    expect(new Set(collectorNames)).toEqual(
      new Set(["link-checker", "directory-health", "sentry-triage"]),
    );
  });

  it("cannot execute legacy Routine, Growth, correlation, MCP, or Seer work", async () => {
    const tombstone = await readFile(activePromptPath, "utf8");

    expect(tombstone).toContain("Growth Pulse is retired");
    expect(tombstone).not.toMatch(/report-run\.mjs|growth-pulse|PostHog/i);
    expect(tombstone).not.toMatch(
      /traffic correlation|cross-check correlation/i,
    );
    expect(tombstone).not.toMatch(/Supabase MCP|Sentry MCP|\bSeer\b/i);
    expect(tombstone).not.toMatch(/cron:|07:10|10 0 \* \* \*/);
  });

  it("treats legacy instructions as archive-only", async () => {
    const configuration = await readFile(configurationPath, "utf8");

    expect(configuration).toContain("There is no active Claude Routine");
    expect(configuration).toContain("Preflight");
    expect(configuration).toContain("GitHub App canary");
    expect(configuration).toContain("Rollback gate");
    expect(configuration).not.toContain("Daily 07:10");
  });
});

// Ungated on purpose: `.env.example` and `scripts/doctor.sh` are both tracked,
// so this half of the contract is enforceable everywhere and must keep running
// in CI even when the docs/routines fixtures above are absent.
describe("Formoria health-agent credential contract", () => {
  it("declares health credentials as empty names and keeps checks opt-in", async () => {
    const [exampleEnv, doctor] = await Promise.all([
      readFile(".env.example", "utf8"),
      readFile("scripts/doctor.sh", "utf8"),
    ]);
    const requiredNames = [
      "FORMORIA_RAILWAY_URL",
      "ORIGIN_SECRET",
      "AGENT_HUB_INGEST_URL",
      "AGENT_HUB_INGEST_TOKEN",
      "SLACK_HEALTH_WEBHOOK_URL",
      "SENTRY_READ_TOKEN",
      "LINEAR_OAUTH_CLIENT_ID",
      "LINEAR_OAUTH_CLIENT_SECRET",
      "LINEAR_TEAM_ID",
      "LINEAR_PROJECT_ID",
      "HEALTH_AGENT_READ_DATABASE_URL",
      "HEALTH_AGENT_READ_DATABASE_PASSWORD",
      "HEALTH_AGENT_WRITE_DATABASE_URL",
      "HEALTH_AGENT_WRITE_DATABASE_PASSWORD",
      "HEALTH_AGENT_GITHUB_APP_ID",
      "HEALTH_AGENT_GITHUB_APP_PRIVATE_KEY",
      "HEALTH_AGENT_GITHUB_APP_INSTALLATION_ID",
      "CLAUDE_CODE_OAUTH_TOKEN",
    ];

    for (const name of requiredNames) {
      expect(exampleEnv).toMatch(new RegExp(`^${name}=$`, "m"));
    }
    expect(doctor).toContain("--health-preflight");
    expect(doctor).toMatch(/--health-live\|--health-autofix/);
    expect(doctor).not.toMatch(/read_only_vars=\([\s\S]*POSTHOG/);
  });
});
