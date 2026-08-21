import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const nightlyPath = ".github/workflows/e2e-nightly.yml";
const releasePath = ".github/workflows/e2e-release.yml";
const manualPath = ".github/workflows/e2e-staging.yml";

async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

describe("staging E2E release and self-heal contract", () => {
  it("runs a complete deployed staging suite on the nightly schedule", async () => {
    const nightly = await source(nightlyPath);
    expect(() => parse(nightly)).not.toThrow();
    expect(nightly).toContain('cron: "5 20 * * *"');
    expect(nightly).toContain("environment: \"Formoria / staging\"");
    expect(nightly).toContain("STAGING_BASE_URL: https://staging.formoria.com");
    expect(nightly).toContain("--project=deep");
    expect(nightly).toContain("--project=mobile");
    expect(nightly).not.toContain("--last-failed");
    expect(nightly).not.toContain("pnpm build");
    expect(nightly).not.toContain("pnpm start");
    expect(nightly).not.toContain("Formoria / production");
    expect(nightly).not.toContain("localhost:3000");
  });

  it("fails closed when deployed identity is missing or stale", async () => {
    const nightly = await source(nightlyPath);
    expect(nightly).toContain("git ls-remote");
    expect(nightly).toContain("refs/heads/staging");
    expect(nightly).toContain("^[0-9a-f]{40}$");
    expect(nightly).toContain("X-Formoria-Revision");
    expect(nightly).toContain("staging did not report the exact tested SHA");
    expect(nightly).toContain("staging revision is missing");
  });

  it("freezes both deployed app and repair-test identities before scope classification", async () => {
    const nightly = await source(nightlyPath);
    const freeze = nightly.slice(
      nightly.indexOf("- name: Freeze complete staging failure context"),
      nightly.indexOf("- name: Upload Playwright report"),
    );
    expect(freeze).toContain("steps.e2e.outcome == 'failure' || steps.report_gate.outcome == 'failure'");
    expect(freeze).toContain("unexpected-skips.json");
    expect(freeze).toContain("type == \"array\" and length > 0");
    expect(freeze).toContain("refusing to freeze an empty staging failure set");
    expect(freeze).toContain("deployed_app_sha");
    expect(freeze).toContain("repair_test_sha");
    expect(freeze).toContain("incident-cli.ts freeze");
    expect(nightly).toContain("git diff --name-status \"$deployed_sha..$repair_sha\"");
    expect(nightly).toContain(".repair_test_sha // empty");
    expect(nightly).not.toContain("|| github.sha");
    expect(nightly).toContain("e2e/**/*.ts");
    expect(nightly).toContain("scope=infrastructure_blocked");
    expect(nightly).toContain("Validate repair action contract");
    expect(nightly).toContain("malformed structured output");
    expect(nightly).toContain("steps.repair_contract.outcome");
    expect(nightly).toContain("scope=repair_blocked");
    expect(nightly).toContain("scripts/selfheal/exact-failure-runner.ts");
    expect(nightly).not.toContain("join(\"|\")");
    expect(nightly).toContain("gh pr ready");
    expect(nightly).toContain("review_pending=true");
    expect(nightly).toContain("outcome=review_ready");
    expect(nightly).toContain('steps.eligibility.outputs.eligible }}" != true');
    expect(nightly).toContain('steps.eligibility.outputs.eligible }}" == true');
    expect(nightly).toContain('steps.eligibility.outputs.eligible }}" != true ]]; then outcome=repair_blocked');
    expect(nightly).toContain("scripts/selfheal/incident-cli.ts eligibility");
    expect(nightly).toContain("scripts/staging-target-check.ts");
    expect(nightly).toContain("Validate staging target identity before self-heal probe");
    expect(nightly).toContain("self-merge-evidence.json");
    expect(nightly).toContain("steps.eligibility.outputs.eligible == 'true'");
    expect(nightly).toContain("READY_TEST_REPAIR: ${{ steps.scope.outputs.scope == 'test_only' && steps.validation.outcome == 'success' && steps.validation_report_gate.outcome == 'success' && steps.eligibility.outputs.eligible == 'true' }}");
    expect(nightly).toContain("assertionCountBefore");
    expect(nightly).toContain("addedLines");
  });

  it("keeps infrastructure retries bounded and test-only repairs staging-only", async () => {
    const nightly = await source(nightlyPath);
    expect(nightly).toContain("Probe deployed staging infrastructure (two validation-only retries)");
    expect(nightly).toContain("for attempt in 0 1 2");
    expect(nightly).toContain("infrastructure_blocked");
    expect(nightly).toContain("Create review-ready repair record for application changes");
    expect(nightly).toContain("Reuse one incident PR");
    expect(nightly).toContain("require independent review");
    expect(nightly).toContain("base staging");
    expect(nightly).toContain("--match-head-commit");
    expect(nightly).not.toContain("--admin");
    expect(nightly).toContain("--delete-branch=false");
    expect(nightly).toContain("Verify frozen exact failure set against deployed staging");
    expect(nightly).toContain("Create or update the self-heal repair branch");
    expect(nightly).toContain("Diagnose the frozen staging failure set");
    expect(nightly).toContain("Repair actionable staging E2E clusters");
    expect(nightly).toContain("Create or update one incident PR");
  });

  it("gates every deployed suite on the JSON skip contract and DEV-1416 is retry-free", async () => {
    const [nightly, manual, release, edge] = await Promise.all([
      source(nightlyPath),
      source(manualPath),
      source(releasePath),
      source("e2e/tests/submit-recommend-edge-cases.spec.ts"),
    ]);
    for (const workflow of [nightly, manual, release]) {
      expect(workflow).toContain("scripts/e2e-report-gate.ts");
      expect(workflow).toContain("scripts/e2e-expected-skips.json");
    }
    expect(edge).toContain("DEV-1416");
    expect(edge).toContain("retries: 0");
    expect(edge).toContain("Array.from({ length: 6 }");
    expect(edge).toContain("new Set(confirmations.map(({ id }) => id)).size");
  });

  it("sends one initial and one terminal staging notification", async () => {
    const nightly = await source(nightlyPath);
    expect(nightly.match(/E2E_SLACK_PHASE: initial/g)).toHaveLength(1);
    expect(nightly).toContain("E2E_SLACK_PHASE: ${{ steps.outcome.outputs.outcome }}");
    expect(nightly).toContain("E2E Staging (Self-heal)");
    expect(nightly).toContain("source_run_id");
    expect(nightly).toContain("source_artifact_name");
  });

  it("keeps manual and release checks fresh and staging-only", async () => {
    const [manual, release] = await Promise.all([
      source(manualPath),
      source(releasePath),
    ]);
    expect(() => parse(manual)).not.toThrow();
    expect(() => parse(release)).not.toThrow();
    expect(manual).toContain("workflow_dispatch");
    expect(release).toContain("pull_request:");
    expect(release).toContain("branches: [main]");
    // DEV-1536: the head is validated in a step that exits 1, not in a
    // job-level `if` that would skip and report SUCCESS to a required check.
    expect(release).toContain(
      "RELEASE_HEAD_REF: ${{ github.event.pull_request.head.ref }}",
    );
    expect(release).toContain('if [[ "$RELEASE_HEAD_REF" != "staging" ]]; then');
    expect(release).not.toContain(
      "github.event.pull_request.head.ref == 'staging'",
    );
    expect(release).toContain("github.event.pull_request.head.sha");
    expect(release).toContain("git ls-remote");
    expect(release).toContain("X-Formoria-Revision");
    for (const workflow of [manual, release]) {
      expect(workflow).toContain("--project=deep");
      expect(workflow).toContain("--project=mobile");
      expect(workflow).not.toContain("--last-failed");
      expect(workflow).not.toContain("pnpm build");
      expect(workflow).not.toContain("Formoria / production");
      expect(workflow).not.toContain("localhost:3000");
    }
  });

  // Bug caught: one report step can silently reintroduce the retired Agent Hub
  // destination while the other remains Turso-only.
  it("keeps nightly and self-heal reports Turso-only", async () => {
    const nightly = await source(nightlyPath);
    const selfHeal = nightly.slice(nightly.indexOf("  self-heal:"));

    for (const name of [
      "AGENT_HUB_TURSO_DATABASE_URL: ${{ secrets.AGENT_HUB_TURSO_DATABASE_URL }}",
      "AGENT_HUB_TURSO_AUTH_TOKEN: ${{ secrets.AGENT_HUB_TURSO_AUTH_TOKEN }}",
    ]) {
      expect(nightly.split(name)).toHaveLength(3);
      expect(selfHeal).toContain(name);
    }
    expect(nightly).not.toMatch(
      /AGENT_HUB_(?:DELIVERY_MODE|INGEST_URL|INGEST_TOKEN)/,
    );
    expect(
      nightly.match(/node scripts\/agent-hub\/report-run\.mjs --file/g),
    ).toHaveLength(2);
    expect(selfHeal).toContain(
      "node scripts/agent-hub/report-run.mjs --file /tmp/formoria-e2e-selfheal.json",
    );
  });
});
