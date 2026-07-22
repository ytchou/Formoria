import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("health watchdog workflow", () => {
  it("runs at 08:30 Taipei and can be dispatched manually", async () => {
    const workflow = await readFile(
      ".github/workflows/health-watchdog.yml",
      "utf8",
    );
    expect(workflow).toContain('cron: "30 0 * * *"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("HEALTH_AGENT_ENABLED == 'true'");
    expect(workflow).toContain("timeout-minutes: 10");
  });

  it("uses only read permissions and the dedicated watchdog script", async () => {
    const workflow = await readFile(
      ".github/workflows/health-watchdog.yml",
      "utf8",
    );
    expect(workflow).toMatch(/permissions:\n  actions: read\n  contents: read/);
    expect(workflow).not.toMatch(/(?:contents|issues|pull-requests): write/);
    expect(workflow).toContain(
      "pnpm exec tsx scripts/health-agent/watchdog.ts",
    );
    expect(workflow).toContain("SLACK_HEALTH_WEBHOOK_URL");
    expect(workflow).toContain("AGENT_HUB_INGEST_TOKEN");
  });

  it("does not expose production mutation or analysis credentials", async () => {
    const workflow = await readFile(
      ".github/workflows/health-watchdog.yml",
      "utf8",
    );
    for (const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "SENTRY_AUTH_TOKEN",
      "SENTRY_RESOLVER_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "LINEAR_OAUTH_TOKEN",
      "HEALTH_GITHUB_APP",
    ]) {
      expect(workflow).not.toContain(forbidden);
    }
  });

  it("uses workflow-attempt identity and redacted delivery metadata", async () => {
    const [workflow, implementation] = await Promise.all([
      readFile(".github/workflows/health-watchdog.yml", "utf8"),
      readFile("scripts/health-agent/watchdog.ts", "utf8"),
    ]);
    expect(workflow).toContain("GITHUB_RUN_ATTEMPT");
    expect(implementation).toContain(
      'github-actions:health-watchdog:${requiredEnvironment("GITHUB_RUN_ID")}:${requiredEnvironment("GITHUB_RUN_ATTEMPT")}',
    );
    expect(implementation).toContain('notification_owner: "github_actions"');
    expect(implementation).toContain("Promise.allSettled");
    expect(implementation).not.toContain("console.log(process.env");
  });

  it("reads only the health-agent workflow and its jobs through GitHub REST", async () => {
    const implementation = await readFile(
      "scripts/health-agent/watchdog.ts",
      "utf8",
    );
    expect(implementation).toContain(
      "actions/workflows/${TARGET_WORKFLOW}/runs",
    );
    expect(implementation).toContain("actions/runs/${run.id}/jobs");
    expect(implementation).toContain('TARGET_WORKFLOW = "health-agent.yml"');
    expect(implementation).toContain('AGGREGATE_JOB = "aggregate-and-deliver"');
    expect(implementation).toContain(
      'DELIVERY_STEP = "Deliver Agent Hub envelopes"',
    );
  });
});
