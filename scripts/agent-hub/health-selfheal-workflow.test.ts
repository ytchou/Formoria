import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("health self-heal workflow", () => {
  it("has correct schedule, gate, label, dry_run default, validation, and 3-issue cap", async () => {
    const [workflow, fixPrompt] = await Promise.all([
      readFile(".github/workflows/health-selfheal.yml", "utf8"),
      readFile(".github/selfheal/health-fix.md", "utf8"),
    ]);

    // Cron fires at 08:10 Taipei (00:10 UTC)
    expect(workflow).toContain('cron: "10 0 * * *"');

    // Guard gates on HEALTH_SELFHEAL_ENABLED repo variable
    expect(workflow).toContain("HEALTH_SELFHEAL_ENABLED");

    // Label must be selfheal-health (sharing the e2e-selfheal "selfheal" label
    // would cause deadlock between the two guards)
    expect(workflow).toContain("selfheal-health");

    // report-run.mjs is used for Agent Hub reporting
    expect(workflow).toContain("report-run.mjs");

    // dry_run workflow_dispatch input exists and defaults to true
    expect(workflow).toContain("dry_run");
    expect(workflow).toContain("default: true");

    // Validation includes tsc type-check; Playwright must NOT be used
    expect(workflow).toContain("pnpm tsc --noEmit");
    expect(workflow).not.toContain("playwright");

    // health-fix.md enforces a 3-issue cap per run
    expect(fixPrompt).toContain("at most 3");
  });
});
