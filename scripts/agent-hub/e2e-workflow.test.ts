import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/e2e-nightly.yml";

async function workflow(): Promise<string> {
  return readFile(workflowPath, "utf8");
}

describe("nightly E2E batch self-heal contract", () => {
  it("is valid YAML and retains the complete deep/mobile nightly scope", async () => {
    const source = await workflow();
    expect(() => parse(source)).not.toThrow();
    expect(source).toContain('cron: "5 20 * * *"');
    expect(source).toContain(
      "TEST_ARGS=(--project=deep --project=mobile --last-failed-file playwright-last-run.json --reporter=html,json)",
    );
    expect(source).toContain(
      "TEST_ARGS=(--project=deep --project=mobile --reporter=html,json)",
    );
  });

  it("makes diagnosis read-only and repair unable to execute Playwright", async () => {
    const source = await workflow();
    const diagnosis = source.slice(
      source.indexOf("- name: Diagnose complete failure set"),
      source.indexOf("- name: Validate diagnosis artifact"),
    );
    const repair = source.slice(
      source.indexOf("- name: Repair every actionable cluster"),
      source.indexOf("- name: Checkpoint repair progress"),
    );
    expect(diagnosis).toContain(".github/selfheal/diagnose.md");
    expect(diagnosis).not.toContain("Read,Write");
    expect(diagnosis).not.toContain("verify-targeted.mjs");
    expect(diagnosis).not.toContain("Bash(pnpm");
    expect(repair).toContain("Read,Write,Edit,Replace");
    expect(repair).not.toContain("verify-targeted.mjs");
    expect(repair).not.toContain("Bash(pnpm");
  });

  it("validates versioned artifacts and runs exact verification once per cycle", async () => {
    const [source, helper] = await Promise.all([
      workflow(),
      readFile("scripts/selfheal/verify-targeted.mjs", "utf8"),
    ]);
    expect(source).toContain("incident-cli.ts freeze");
    expect(source).toContain("incident-cli.ts validate-diagnosis");
    expect(source).toContain("incident-cli.ts validate-repair");
    expect(
      source.match(/node scripts\/selfheal\/verify-targeted\.mjs/g),
    ).toHaveLength(1);
    expect(helper).toContain('"--last-failed"');
    expect(helper).toContain('"--last-failed-file"');
    expect(helper).toContain(
      "Stored Playwright test IDs are no longer collectible",
    );
  });

  it("caps repair, infrastructure, and base-sync continuations incident-wide", async () => {
    const source = await workflow();
    expect(source).toContain('options: ["1", "2", "3"]');
    expect(source).toContain("steps.context.outputs.repair_cycle != '3'");
    expect(source).toContain("steps.context.outputs.repair_cycle == '3'");
    expect(source).toContain("inputs.infrastructure_retries != '2'");
    expect(source).toContain(
      "infrastructure remained unavailable after two validation-only retries",
    );
    expect(source).toContain("inputs.base_sync_attempts || '0'");
    expect(source).toContain('inputs.base_sync_attempts || \'0\' }}" = "2"');
  });

  it("classifies infrastructure before agents with an audited authenticated probe", async () => {
    const source = await workflow();
    const probe = source.indexOf("- name: Probe Supabase infrastructure");
    const diagnosis = source.indexOf("- name: Diagnose complete failure set");
    expect(probe).toBeGreaterThan(0);
    expect(probe).toBeLessThan(diagnosis);
    expect(source).toContain("lightweight_authenticated_query");
    expect(source).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(source).toContain("PROBE_AUTHENTICATED=false");
    expect(source).toContain("auth_mode:$auth_mode");
    expect(source).toContain("latency_ms");
    expect(source).toContain("classify-infrastructure");
    expect(source).not.toContain("request:{credential");
  });

  it("publishes the repair branch before dispatching infrastructure recovery", async () => {
    const source = await workflow();
    const dispatch = source.indexOf(
      "- name: Dispatch infrastructure-only retry",
    );
    const diagnosis = source.indexOf("- name: Diagnose complete failure set");
    const section = source.slice(dispatch, diagnosis);
    const push = section.indexOf(
      'git push origin "$REPAIR_BRANCH" --force-with-lease',
    );
    expect(push).toBeGreaterThan(-1);
    expect(push).toBeLessThan(
      section.indexOf("gh workflow run e2e-nightly.yml"),
    );
  });

  it("can turn a recovered infrastructure retry into the next repair cycle", async () => {
    const source = await workflow();
    const report = source.slice(
      source.indexOf("- name: Prepare self-heal report for next round"),
      source.indexOf("- name: Upload self-heal report for next round"),
    );
    expect(report).toContain("inputs.continuation_kind == 'infrastructure'");
    expect(report).toContain("steps.validation.outcome != 'success'");
  });

  it("creates one draft PR and reuses its number across continuations", async () => {
    const source = await workflow();
    expect(source).toContain("Create or update incident draft PR");
    expect(source).toContain("gh pr list");
    expect(source).toContain("gh pr edit");
    expect(source).toContain("--field incident_pr_number=");
    expect(source).toContain(
      "steps.incident_pr.outputs.pr_number || inputs.incident_pr_number",
    );
    expect(source).toContain("e2e-nightly --state open");
  });

  it("self-merges only after every current-head test-only gate without admin bypass", async () => {
    const source = await workflow();
    expect(source).toContain("incident-cli.ts eligibility");
    expect(source).toContain('.verdict == "PASS" and .risk == "low"');
    expect(source).toContain(".reviewed_head_sha == $head");
    expect(source).toContain('["Quality","Build","select-targeted-e2e"]');
    expect(source).toContain('select(.name == "e2e-targeted"');
    expect(source).toContain("git merge-base --is-ancestor");
    expect(source).toContain(
      'gh pr merge "$PR_NUMBER" --squash --match-head-commit "$HEAD_SHA"',
    );
    expect(source).not.toContain("--admin");
  });

  it("keeps continuations Slack-silent and reports eligibility separately from merge", async () => {
    const source = await workflow();
    const selfheal = source.slice(
      source.indexOf("  selfheal:\n"),
      source.indexOf("  selfheal-terminal:\n"),
    );
    expect(selfheal).not.toContain("e2e-slack.ts");
    expect(source.match(/E2E_SLACK_PHASE: initial/g)).toHaveLength(1);
    expect(source).toContain(
      "E2E_SLACK_PHASE: ${{ needs.selfheal.outputs.terminal_outcome }}",
    );
    expect(source).toContain(
      "needs.selfheal.outputs.continuation_dispatched != 'true'",
    );
    expect(source).toContain("auto_merge_eligible: $auto_merge_eligible");
    expect(source).toContain("actually_merged: $actually_merged");
    expect(source).toContain("merge_commit_sha: $merge_commit_sha");
  });

  it("retains complete Agent Hub, artifact, build-log, and source-failure evidence", async () => {
    const source = await workflow();
    expect(source).toContain("AGENT_HUB_INGEST_URL");
    expect(source).toContain("AGENT_HUB_INGEST_TOKEN");
    expect(
      source.match(/node scripts\/agent-hub\/report-run\.mjs --file/g),
    ).toHaveLength(2);
    expect(source).toContain("SLACK_FORMORIA_WEBHOOK_URL");
    expect(source).not.toContain("SLACK_HEALTH_WEBHOOK_URL");
    expect(source).toContain("retention-days: 7");
    expect(source).toContain("test-results");
    expect(source).toContain(
      'pnpm build 2>&1 | tee "$RUNNER_TEMP/formoria-selfheal-build.log"',
    );
    expect(source).toContain(
      "SOURCE_FAILED_SPECS: ${{ needs.e2e-deep.outputs.failed_specs }}",
    );
    expect(source).toContain(
      "SOURCE_FAILURE_STATE: ${{ inputs.source_failure_state }}",
    );
  });
});
