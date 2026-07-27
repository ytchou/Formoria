import { access, readFile } from "node:fs/promises";

import * as prettier from "prettier";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/health-agent.yml";
const retiredPaths = [
  ".github/workflows/health-agent-collect.yml",
  ".github/workflows/health-agent-analyze.yml",
  ".github/workflows/health-agent-deliver.yml",
  ".github/workflows/health-agent-repair.yml",
  ".github/workflows/health-agent-publish.yml",
  ".github/workflows/quality-nightly.yml",
  ".github/selfheal/quality-fix.md",
  ".github/selfheal/quality-review.md",
  "scripts/notifications/quality-slack.ts",
];

describe("unified health-agent workflow contract", () => {
  it("keeps the scheduled and manual control plane in one job with five visible stages", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    await expect(
      prettier.format(workflow, { parser: "yaml" }),
    ).resolves.toBeTruthy();
    const jobs = workflow.slice(workflow.indexOf("\njobs:\n") + 7);

    expect(
      [...jobs.matchAll(/^  ([a-z0-9-]+):$/gm)].map((match) => match[1]),
    ).toEqual(["nightly-health"]);
    for (const stage of [
      "Stage 1",
      "Stage 2",
      "Stage 3",
      "Stage 4",
      "Stage 5",
    ]) {
      expect(workflow).toContain(stage);
    }
    expect(workflow).toContain('cron: "13 23 * * *"');
    expect(workflow).toContain("expected_at");
    expect(workflow).toContain("delay_seconds");
  });

  it("lets independent health groups finish and records both repository detectors", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    for (const id of [
      "link",
      "brand",
      "directory-evidence",
      "directory",
      "sentry-collect",
      "quality",
    ]) {
      expect(workflow).toMatch(
        new RegExp(`id: ${id}\\n[\\s\\S]{0,100}?continue-on-error: true`),
      );
    }
    expect(workflow).toContain("quality-runtime.ts");
    expect(workflow).toContain("--quality-artifact");
    expect(workflow).toContain("sentry-analysis-2");
    expect(workflow).toContain(
      "steps.sentry-materialize-1.outcome != 'success'",
    );
  });

  it("uses one write-capable Sentry token for collection and verified resolution", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow.match(/secrets\.SENTRY_READ_TOKEN/g)).toHaveLength(3);
    expect(workflow).not.toContain("SENTRY_RESOLVER_TOKEN");
  });

  it("passes the Supabase URL to the live Directory snapshot writer", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const directoryStep = workflow.slice(
      workflow.indexOf(
        'name: "Stage 2 · Product health — Directory evaluation"',
      ),
      workflow.indexOf('name: "Stage 2 · Runtime health — collect Sentry"'),
    );

    expect(directoryStep).toContain(
      "NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}",
    );
  });

  it("forwards the requested deterministic canary into queue reconciliation", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const queueStep = workflow.slice(
      workflow.indexOf('name: "Stage 3 · Consolidate — queue and reconcile"'),
      workflow.indexOf('name: "Stage 3 · Consolidate — manager repair scope"'),
    );

    expect(queueStep).toContain(
      '--canary-fingerprints "${{ inputs.canary_fingerprints }}"',
    );
  });

  it("sends only the findings report and final report and uploads one run artifact", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow.match(/initial-report\.ts/g)).toHaveLength(1);
    expect(workflow.match(/workflow-runtime\.ts final-report/g)).toHaveLength(
      1,
    );
    expect(workflow.match(/actions\/upload-artifact@/g)).toHaveLength(1);
    expect(workflow).toContain(
      "health-run-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(workflow).toContain("health-run.json");
    expect(workflow).toContain("audit.jsonl");
    expect(workflow).not.toContain("actions/download-artifact@");
  });

  it("caps repair at two cycles, publishes at most one human-reviewed PR, and never merges", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow.match(/Self-heal — repair cycle [12]/g)).toHaveLength(2);
    expect(workflow.match(/gh pr create/g)).toHaveLength(1);
    expect(workflow).toContain("gh auth setup-git");
    expect(workflow).toContain("secrets.HEALTH_AGENT_GITHUB_APP_ID");
    expect(workflow).toContain("secrets.HEALTH_AGENT_GITHUB_APP_PRIVATE_KEY");
    expect(workflow).not.toContain("secrets.HEALTH_GITHUB_APP_ID");
    expect(workflow).not.toContain("secrets.HEALTH_GITHUB_APP_PRIVATE_KEY");
    expect(workflow).toContain("--auto-merge-enabled false");
    expect(workflow).not.toMatch(/gh pr merge|--auto(?:\s|$)/i);
    expect(workflow).toContain("validate-repair-patch.sh");
    expect(workflow).toContain("manager-snapshot.json");
    expect(workflow.match(/--json-schema/g)).toHaveLength(4);
    expect(workflow).toContain("steps.review-decision-1.outcome");
    expect(workflow).toContain("steps.review-decision-2.outcome");
    expect(workflow).not.toMatch(
      /steps\.review-[12]\.outcome == 'success' \|\|/,
    );
    expect(workflow.match(/startswith\("quality:dead-code:"\)/g)).toHaveLength(
      2,
    );
    expect(workflow).toContain(
      "permissions:\n  contents: read\n  id-token: write\n  pull-requests: read",
    );
  });

  it("fails the GitHub job only after saving the consolidated artifact when infrastructure failed", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const upload = workflow.indexOf('name: "Stage 5 · Upload health run"');
    const failure = workflow.indexOf(
      'name: "Stage 5 · Surface infrastructure failures"',
    );

    expect(upload).toBeGreaterThan(-1);
    expect(failure).toBeGreaterThan(upload);
    expect(workflow.slice(failure)).toContain('all(.status != "failed")');
    expect(workflow.slice(failure)).toContain(
      '.managerReport.envelope.status != "failed"',
    );
  });

  it("removes every superseded control-plane file", async () => {
    for (const path of retiredPaths) {
      await expect(access(path)).rejects.toThrow();
    }
  });

  it("replays the single run artifact without rerunning collectors", async () => {
    const replay = await readFile(
      ".github/workflows/health-agent-replay.yml",
      "utf8",
    );
    await expect(
      prettier.format(replay, { parser: "yaml" }),
    ).resolves.toBeTruthy();

    expect(replay).not.toContain("schedule:");
    expect(replay).toContain(
      '--name "health-run-${SOURCE_RUN_ID}-${SOURCE_ATTEMPT}"',
    );
    expect(replay).toContain("replay-run.sh");
    expect(replay).not.toMatch(/collect-link|collect-sentry|quality-runtime/);
  });

  it("pins all third-party actions to immutable commits", async () => {
    const workflows = await Promise.all([
      readFile(workflowPath, "utf8"),
      readFile(".github/workflows/health-agent-replay.yml", "utf8"),
      readFile(".github/workflows/health-agent-confirmation.yml", "utf8"),
    ]);

    for (const workflow of workflows) {
      for (const [, ref] of workflow.matchAll(/uses:\s+[^\s]+@([^\s#]+)/g)) {
        expect(ref).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });
});
