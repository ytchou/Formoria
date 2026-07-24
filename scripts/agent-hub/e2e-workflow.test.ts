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
    expect(workflow).toContain("actions: write\n      contents: read");
    expect(workflow).toContain(
      'pnpm build 2>&1 | tee "$RUNNER_TEMP/formoria-build.log"',
    );
    expect(workflow).toContain(
      'pnpm build 2>&1 | tee "$RUNNER_TEMP/formoria-selfheal-build.log"',
    );
    expect(workflow).toContain("id: selfheal_build");
    expect(workflow).toContain(
      'if [ "$BUILD_OUTCOME" = "failure" ] && [ -s "$RUNNER_TEMP/formoria-selfheal-build.log" ]; then',
    );
    expect(workflow).toContain(
      'cp "$RUNNER_TEMP/formoria-selfheal-build.log" "$REPORT_DIR/build.log"',
    );
    expect(workflow).toContain("failure_context:");
    expect(workflow).toContain(
      'GH_TOKEN="$WORKFLOW_DISPATCH_TOKEN" gh workflow run e2e-nightly.yml',
    );
    expect(workflow.match(/allowed_bots: github-actions/g)).toHaveLength(2);
    expect(workflow).toContain('claude_args: "--max-turns 40"');
    expect(workflow).toContain(
      "Return the required VERDICT, JUSTIFICATION, APP_FILES, and RISK lines",
    );

    const reportIndex = workflow.indexOf("Report E2E results to Agent Hub");
    const alertIndex = workflow.indexOf("actions/github-script@");
    expect(reportIndex).toBeGreaterThan(0);
    expect(alertIndex).toBeGreaterThan(reportIndex);
  });
});
