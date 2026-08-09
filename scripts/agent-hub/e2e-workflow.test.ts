import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("nightly E2E Agent Hub reporting", () => {
  it("routes mobile coverage and repair validation through the mobile project", async () => {
    const [config, mobileSpec, workflow, guidance] = await Promise.all([
      readFile("playwright.config.ts", "utf8"),
      readFile("e2e/tests/mobile.spec.ts", "utf8"),
      readFile(".github/workflows/e2e-nightly.yml", "utf8"),
      readFile(".github/selfheal/triage-fix.md", "utf8"),
    ]);

    expect(config).toMatch(
      /testIgnore:\s*["']e2e\/tests\/mobile\.spec\.ts["']/,
    );
    // Mobile coverage must not be disabled wholesale — that is what would make
    // the nightly self-heal route repairs against a project that never ran.
    // A conditional in-test environment guard is NOT that: `test.skip(cond, …)`
    // after a 503 from PREVIEW_MODE, or the `test.skip(!adminEmail, …)` idiom the
    // admin specs use, still executes the spec everywhere the condition is false
    // (no workflow sets PREVIEW_MODE, so it never fires in CI). The original
    // assertion banned the substring `test.skip(` outright, which turned the
    // first legitimate guarded skip (#618) into a red main. Forbid only the
    // forms that remove coverage unconditionally.
    expect(mobileSpec).not.toMatch(/test\.describe\.skip\s*\(/);
    expect(mobileSpec).not.toMatch(/(?<!\w)test\.skip\s*\(\s*\)/);
    expect(workflow).toContain(
      "TEST_ARGS=(--project=deep --project=mobile --last-failed-file playwright-last-run.json --reporter=html,json)",
    );
    expect(workflow).toContain(
      'project: ([$spec.tests[]?.projectName // empty] | unique | .[0] // "deep")',
    );
    expect(workflow).toContain(
      "PLAYWRIGHT_LAST_RUN_OUTPUT_FILE: playwright-last-run.json",
    );
    expect(workflow).toContain("node scripts/selfheal/verify-targeted.mjs");
    expect(guidance).toContain(
      "Playwright's native `--last-failed-file` selection",
    );
    expect(guidance).not.toContain("affected deep spec");
  });

  it("uses scoped reporting, complete evidence, and a Formoria Slack webhook", async () => {
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
    expect(workflow).toContain("test-results");
    expect(workflow).toContain("selfheal-context.json");
    expect(workflow).toContain("repair-ledger.json");
    expect(
      workflow.match(/notification_owner: "github_actions"/g),
    ).toHaveLength(2);
    expect(workflow).toContain("SLACK_FORMORIA_WEBHOOK_URL");
    expect(workflow).not.toContain("SLACK_HEALTH_WEBHOOK_URL");
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
    expect(workflow).toContain("playwright-last-run.json");
    expect(workflow).toContain(
      'GH_TOKEN="$WORKFLOW_DISPATCH_TOKEN" gh workflow run e2e-nightly.yml',
    );
    expect(workflow).toContain('git fetch origin "$REPAIR_BASE" --prune');
    expect(workflow).toContain('git rebase "origin/$REPAIR_BASE"');
    expect(workflow.match(/allowed_bots: github-actions/g)).toHaveLength(2);
    expect(workflow).toContain(
      '--allowedTools "Read,Write,Edit,Replace,Glob,Grep',
    );
    expect(workflow).toContain(
      "Bash(node scripts/selfheal/verify-targeted.mjs:*)",
    );
    expect(workflow).toContain("Bash(git status:*)");
    expect(workflow).not.toContain("Bash(git:*)");
    expect(workflow).toContain("additional_permissions: |");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain(
      '--allowedTools "Read,Glob,Grep,Bash(git status:*)',
    );
    expect(workflow).toContain("id: review_gate");
    expect(workflow).toContain("REVIEW_RESULT");
    expect(workflow).toContain('.verdict == "PASS"');

    const reportIndex = workflow.indexOf("Report E2E results to Agent Hub");
    const alertIndex = workflow.indexOf("actions/github-script@");
    expect(reportIndex).toBeGreaterThan(0);
    expect(alertIndex).toBeGreaterThan(reportIndex);
  });

  it("repairs one shrinking set in at most two cycles", async () => {
    const [workflow, contract] = await Promise.all([
      readFile(".github/workflows/e2e-nightly.yml", "utf8"),
      readFile(".github/selfheal/README.md", "utf8"),
    ]);

    expect(workflow).toContain("--max-turns 120");
    expect(workflow).toContain("repair_cycle:");
    expect(workflow).toContain("Checkpoint repair progress");
    expect(workflow).toContain("steps.checkpoint.outputs.complete == 'true'");
    expect(workflow).toContain("steps.checkpoint.outputs.complete != 'true'");
    expect(workflow).toContain("Continue incomplete repair as cycle 2");
    expect(workflow).toContain("steps.context.outputs.repair_cycle == '1'");
    expect(workflow).toContain(
      '--field previous_state="$STATE_AFTER" --field repair_cycle=2',
    );
    expect(workflow).toContain("Create blocked draft PR at cycle cap");
    expect(workflow).not.toContain("Continue incomplete self-heal");
    expect(workflow).not.toContain("repair_cycle=3");
    expect(contract).toContain("A third cycle is forbidden");
    expect(contract).toContain("root_source_run_id");
  });

  it("passes cycle-2 grep values as raw workflow fields", async () => {
    const workflow = await readFile(
      ".github/workflows/e2e-nightly.yml",
      "utf8",
    );
    const continuationBlocks = [
      workflow.slice(
        workflow.indexOf("Continue incomplete repair as cycle 2"),
        workflow.indexOf("Refresh dependencies after fix"),
      ),
      workflow.slice(
        workflow.indexOf("Continue red self-heal"),
        workflow.indexOf("Create blocked draft PR at cycle cap"),
      ),
    ];

    expect(continuationBlocks).toHaveLength(2);
    for (const block of continuationBlocks) {
      expect(block).toContain('--raw-field e2e_grep="$E2E_GREP"');
      expect(block).not.toContain('--field e2e_grep="$E2E_GREP"');
    }
  });

  it("validates declared checkpoints and reports additive incident usage", async () => {
    const workflow = await readFile(
      ".github/workflows/e2e-nightly.yml",
      "utf8",
    );
    expect(workflow).toContain(
      "declared changed_files do not match the actual repair diff",
    );
    expect(workflow).toContain("$RUNNER_TEMP/selfheal-scratch");
    expect(workflow).toContain("Record repair usage");
    expect(workflow).toContain("root_source_run_id");
    expect(workflow).toContain("targeted_attempts");
    expect(workflow).toContain("model_usage");
  });

  it("runs targeted verification against a development server in CI", async () => {
    const [config, helper] = await Promise.all([
      readFile("playwright.config.ts", "utf8"),
      readFile("scripts/selfheal/verify-targeted.mjs", "utf8"),
    ]);

    expect(helper).toContain('SELFHEAL_TARGETED: "true"');
    expect(config).toContain('process.env.SELFHEAL_TARGETED === "true"');
    expect(config).toContain('"PLAYWRIGHT_TEST=true pnpm dev"');
  });

  it("guards canary bases and never auto-merges a self-heal PR", async () => {
    const workflow = await readFile(
      ".github/workflows/e2e-nightly.yml",
      "utf8",
    );

    expect(workflow).toContain("repair_base:");
    expect(workflow).toContain("selfheal-test/*");
    expect(workflow).toContain('--base "$REPAIR_BASE"');
    expect(workflow).toContain("Manual review and merge required");
    expect(workflow).not.toContain("gh pr merge");
    expect(workflow).not.toContain("dry_run");
  });

  it("sends one initial result and one terminal ready-or-blocked result", async () => {
    const workflow = await readFile(
      ".github/workflows/e2e-nightly.yml",
      "utf8",
    );

    expect(workflow.match(/E2E_SLACK_PHASE: initial/g)).toHaveLength(1);
    expect(workflow.match(/E2E_SLACK_PHASE: ready/g)).toHaveLength(1);
    expect(workflow.match(/E2E_SLACK_PHASE: blocked/g)).toHaveLength(1);
    expect(workflow).toContain(
      "SELFHEAL_ENABLED: ${{ vars.SELFHEAL_ENABLED }}",
    );
    expect(workflow).toContain("needs: [selfheal]");
    expect(workflow).toContain(
      "needs.selfheal.outputs.continuation_dispatched != 'true'",
    );
    expect(workflow).toContain("Notify Slack that the self-heal PR is ready");
    expect(workflow).toContain("Notify Slack that self-heal is blocked");
    expect(workflow).toContain(
      "needs.selfheal.outputs.blocked_reason == '' && needs.selfheal.outputs.pr_url != ''",
    );
    expect(workflow).toContain("needs.selfheal.outputs.blocked_reason != ''");

    const selfhealStart = workflow.indexOf("  selfheal:\n");
    const terminalStart = workflow.indexOf("  selfheal-terminal:\n");
    const selfheal = workflow.slice(selfhealStart, terminalStart);
    expect(selfheal).not.toContain("e2e-slack.ts");
    expect(selfheal).not.toContain("Notify Slack");
    expect(workflow).toContain(
      "FAILED_SPECS_FOR_REPORT: ${{ steps.terminal_state.outputs.failed_specs || '[]' }}",
    );
    expect(workflow).toContain(
      "E2E_FAILED_SPECS: ${{ needs.selfheal.outputs.failed_specs || '[]' }}",
    );
    expect(workflow).toContain(
      "E2E_REPORT_AVAILABLE: ${{ needs.selfheal.outputs.report_available || 'false' }}",
    );
    expect(workflow).toContain(
      "needs.selfheal.outputs.blocked_reason == '' && needs.selfheal.outputs.pr_url != ''",
    );
    expect(workflow).toContain("needs.selfheal.outputs.blocked_reason != ''");

    const readyCondition =
      "if: needs.selfheal.outputs.blocked_reason == '' && needs.selfheal.outputs.pr_url != ''";
    const blockedCondition = "if: needs.selfheal.outputs.blocked_reason != ''";
    expect(
      workflow.slice(workflow.indexOf("  selfheal-terminal:\n")),
    ).toContain(readyCondition);
    expect(
      workflow.slice(workflow.indexOf("  selfheal-terminal:\n")),
    ).toContain(blockedCondition);
  });

  it("preserves source failures when the guard skips before downloading context", async () => {
    const workflow = await readFile(
      ".github/workflows/e2e-nightly.yml",
      "utf8",
    );

    expect(workflow).toContain(
      "failed_specs: ${{ steps.nightly_report.outputs.failed_specs }}",
    );
    expect(workflow).toContain(
      "SOURCE_FAILED_SPECS: ${{ needs.e2e-deep.outputs.failed_specs }}",
    );
    expect(workflow).toContain(
      "SOURCE_FAILED_COUNT: ${{ needs.e2e-deep.outputs.failed }}",
    );
    expect(workflow).toContain("source_failure_state:");
    expect(workflow).toContain("if: inputs.selfheal_only != true");
    expect(workflow).toContain(
      "SOURCE_FAILURE_STATE: ${{ inputs.source_failure_state }}",
    );
    expect(
      workflow.match(
        /--field source_failure_state=\"\$SOURCE_FAILURE_STATE\"/g,
      ),
    ).toHaveLength(2);
    expect(workflow).toContain(
      'if [ -n "$SOURCE_FAILURE_STATE" ] && jq -e . >/dev/null 2>&1 <<<"$SOURCE_FAILURE_STATE"',
    );
    expect(workflow).toContain(
      "FAILED_SPECS=$(printf '%s' \"${SOURCE_FAILED_SPECS:-[]}\" | jq -c . 2>/dev/null || printf '[]')",
    );
    expect(workflow).toContain('echo "failed=$SOURCE_FAILED_COUNT"');
    expect(workflow).toContain('echo "skip=true" >> "$GITHUB_OUTPUT"');
  });
});
