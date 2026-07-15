import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("nightly E2E Agent Hub reporting", () => {
  it("uses the scoped reporter, off-hour schedule, and failure-only artifacts", async () => {
    const workflow = await readFile(
      ".github/workflows/e2e-nightly.yml",
      "utf8",
    );

    expect(workflow).toContain('cron: "10 22 * * *"');
    expect(workflow).toContain("AGENT_HUB_INGEST_URL");
    expect(workflow).toContain("AGENT_HUB_INGEST_TOKEN");
    expect(workflow).toContain("node scripts/agent-hub/report-run.mjs --file");
    expect(workflow).toContain(
      'TZ=Asia/Taipei date -d "$workflow_started_at" +%F',
    );
    expect(workflow).toContain("retention-days: 7");
    expect(workflow).not.toContain("TZ=Asia/Taipei date +%F");
    expect(workflow).not.toContain("AGENT_HUB_SERVICE_KEY");
    expect(workflow).not.toContain("rest/v1/rpc/insert_routine_run");

    const reportIndex = workflow.indexOf("Report E2E results to Agent Hub");
    const alertIndex = workflow.indexOf("actions/github-script@v7");
    expect(reportIndex).toBeGreaterThan(0);
    expect(alertIndex).toBeGreaterThan(reportIndex);
  });
});
