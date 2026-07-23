import { readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";

import * as prettier from "prettier";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/health-agent.yml";

function jobSection(workflow: string, job: string, nextJob?: string): string {
  const start = workflow.indexOf(`  ${job}:`);
  const end = nextJob
    ? workflow.indexOf(`\n  ${nextJob}:`, start)
    : workflow.length;
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe("unified health-agent workflow contract", () => {
  it("is parseable and has the daily trigger, dispatch modes, and writer lock", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    await expect(
      prettier.format(workflow, { parser: "yaml" }),
    ).resolves.toBeTruthy();

    expect(workflow).toContain('cron: "0 23 * * *"');
    expect(workflow).toContain("- preflight");
    expect(workflow).toContain("- live");
    expect(workflow).toContain("- canary_fix");
    expect(workflow).toContain("group: formoria-agent-writer");
    expect(workflow).toContain('"$HEALTH_AGENT_ENABLED" != "true"');
    expect(workflow).toContain('"$HEALTH_AUTOFIX_ENABLED" != "true"');
    expect(workflow).toContain(
      "canary_fix requires explicit canary_fingerprints",
    );
  });

  it("keeps collection dependencies ordered while link and Sentry start independently", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    expect(workflow).toMatch(/collect-link:\n\s+needs: gate/);
    expect(workflow).toMatch(/collect-sentry:\n\s+needs: gate/);
    expect(workflow).toMatch(
      /evaluate-directory:\n\s+needs: \[gate, collect-link\]/,
    );
    expect(workflow).toMatch(
      /aggregate-and-deliver:\n\s+needs: \[gate, collect-link, evaluate-directory, sentry-triage\]/,
    );
    expect(workflow).toMatch(
      /aggregate-and-deliver:\n\s+needs:[\s\S]*?\n\s+if: always\(\)/,
    );
    expect(workflow).toContain("- name: Deliver Agent Hub envelopes");
    expect(workflow).toContain("aggregate-and-deliver");
    expect(workflow).not.toContain("--limit");
  });

  it("brand-review job depends only on gate", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const aggregate = jobSection(
      workflow,
      "aggregate-and-deliver",
      "cleanup-stale-branches",
    );

    expect(workflow).toMatch(/brand-review:\n    needs: \[gate\]/);
    expect(aggregate).not.toMatch(/needs: \[[^\]]*brand-review[^\]]*\]/);
  });

  it("brand-review job uses correct secrets", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const brandReview = jobSection(
      workflow,
      "brand-review",
      "secretless-validation",
    );

    expect(brandReview).toMatch(/HEALTH_AGENT_READER_TOKEN/);
    expect(brandReview).toMatch(/HEALTH_AGENT_WRITER_TOKEN/);
    expect(brandReview).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(brandReview).toMatch(/SLACK_HEALTH_WEBHOOK_URL/);
  });

  it("brand-review job creates its artifact directory", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const brandReview = jobSection(
      workflow,
      "brand-review",
      "secretless-validation",
    );

    expect(brandReview).toMatch(/mkdir -p \.health-agent-artifacts/);
  });

  it("uploads hidden-directory artifacts through explicit paths", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const directory = jobSection(
      workflow,
      "evaluate-directory",
      "sentry-triage",
    );
    const sentry = jobSection(
      workflow,
      "sentry-triage",
      "aggregate-and-deliver",
    );
    const repairBatches = jobSection(
      workflow,
      "prepare-repair-batches",
      "automatic-repair",
    );
    const automaticRepair = jobSection(
      workflow,
      "automatic-repair",
      "human-repair",
    );
    const humanRepair = jobSection(
      workflow,
      "human-repair",
      "escalate-repair-failure",
    );

    expect(directory).toContain(
      "path: |\n            .health-agent-artifacts/directory-evidence.json\n            .health-agent-artifacts/directory-health.json",
    );
    expect(directory).not.toContain(
      "path: .health-agent-artifacts/directory*.json",
    );
    expect(sentry).toContain(
      "path: .health-agent-artifacts/sentry-triage.json",
    );
    expect(sentry).not.toContain("path: .health-agent-artifacts/sentry*.json");
    expect(repairBatches).toContain(
      "path: |\n            .health-agent-artifacts/automatic-snapshot.json\n            .health-agent-artifacts/automatic-metadata.json\n            .health-agent-artifacts/automatic-audit.json\n            .health-agent-artifacts/human-snapshot.json\n            .health-agent-artifacts/human-metadata.json\n            .health-agent-artifacts/human-audit.json",
    );
    expect(automaticRepair).toContain(
      "permissions:\n      contents: read\n      id-token: write",
    );
    expect(humanRepair).toContain(
      "permissions:\n      contents: read\n      id-token: write",
    );
    expect(automaticRepair).toContain(
      ".health-agent-artifacts/automatic-cycle-1.json",
    );
    expect(automaticRepair).toContain(
      ".health-agent-artifacts/automatic-cycle-2.json",
    );
    expect(automaticRepair).toContain(
      ".health-agent-artifacts/automatic-review-1.json",
    );
    expect(automaticRepair).toContain(
      ".health-agent-artifacts/automatic-review-2.json",
    );
    expect(humanRepair).toContain(".health-agent-artifacts/human-cycle-1.json");
    expect(humanRepair).toContain(".health-agent-artifacts/human-cycle-2.json");
    expect(humanRepair).toContain(
      ".health-agent-artifacts/human-review-1.json",
    );
    expect(humanRepair).toContain(
      ".health-agent-artifacts/human-review-2.json",
    );
    expect(workflow).not.toMatch(/\.health-agent-artifacts\/[^\n]*\*/);
  });

  it("uses exactly three collector routines and one aggregated Slack delivery", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    expect(
      (
        workflow.match(
          /--output \.health-agent-artifacts\/link-checker\.json/g,
        ) ?? []
      ).length,
    ).toBe(1);
    expect(workflow).toContain(
      "--output .health-agent-artifacts/directory-health.json",
    );
    expect(workflow).toContain(
      "--output .health-agent-artifacts/sentry-triage.json",
    );
    expect((workflow.match(/aggregate-and-deliver --mode/g) ?? []).length).toBe(
      1,
    );
    expect(workflow).toContain("AGENT_HUB_INGEST_URL");
    expect(workflow).toContain("SLACK_HEALTH_WEBHOOK_URL");
    expect(workflow).toContain("LINEAR_OAUTH_ACCESS_TOKEN");
    expect(workflow).not.toContain("health-sentry-final");
  });

  it("isolates Claude to sanitized artifacts and caps each batch at two explicit cycles", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const claudeUses = [
      ...workflow.matchAll(/uses:\s+anthropics\/claude-code-action@([^\s#]+)/g),
    ];
    expect(claudeUses).toHaveLength(10);
    for (const [, ref] of claudeUses) {
      expect(ref).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(workflow).toContain("sentry-issues.json");
    expect(workflow).toContain("automatic-snapshot.json");
    expect(workflow).toContain("human-snapshot.json");
    expect(workflow).toContain("--allowedTools Read,Glob,Grep");
    expect(workflow).toContain(
      'claude_args: "--allowedTools Read,Glob,Grep,Edit,Write',
    );
    expect(workflow).toContain(
      "--disallowedTools Bash,Edit,Write,WebFetch,WebSearch,Task",
    );
    expect(workflow).not.toContain("--allowedTools Bash");
    expect(workflow).toContain("automatic-repair:");
    expect(workflow).toContain("human-repair:");
    expect(workflow).not.toContain("human_repair");
    expect(workflow).toContain("outputs.structured_output");
    expect(workflow).not.toContain("outputs.result");
    expect(workflow).toContain("steps.automatic-decision-1.outcome");
    expect(workflow).toContain("steps.human-decision-1.outcome");
    expect(workflow).toContain("explicit final repair cycle, cycle 2");
    expect(workflow).toContain("This is explicit final cycle");
    expect(workflow).toContain(
      "test -s .health-agent-artifacts/automatic.patch",
    );
    expect(workflow).toContain("test -s .health-agent-artifacts/human.patch");
    expect(workflow.match(/--slurpfile expected/g) ?? []).toHaveLength(4);
    expect(
      workflow.match(/\.snapshot_id == \$expected\[0\]\.snapshotId/g) ?? [],
    ).toHaveLength(4);
    expect(workflow.match(/\.cycle == [12]/g) ?? []).toHaveLength(4);
    expect(
      (workflow.match(/\.findings\[\]\.fingerprint/g) ?? []).length,
    ).toBeGreaterThanOrEqual(8);
    expect(workflow).toContain('"minItems":1');
    expect(workflow).toContain('"required":["fingerprint","verdict"]');
    const schemaArguments = [
      ...workflow.matchAll(/--json-schema '(\{[^\n]+\})'/g),
    ].map(([, schema]) => schema);
    expect(schemaArguments).toHaveLength(6);
    for (const schema of schemaArguments) {
      expect(() => JSON.parse(schema)).not.toThrow();
    }
    expect(workflow).not.toMatch(/--json-schema\s+\{/);
    const classifierStart = workflow.indexOf("  sentry-triage:");
    const classifierEnd = workflow.indexOf("\n  aggregate-and-deliver:");
    const classifier = workflow.slice(classifierStart, classifierEnd);
    expect(classifier).not.toMatch(
      /SENTRY_READ_TOKEN|NEXT_PUBLIC_SUPABASE_URL|FORMORIA_RAILWAY_URL/,
    );
    expect(classifier).toContain("sentry-classification.schema.json");
    const promptStart = classifier.indexOf("prompt: |");
    const argsStart = classifier.indexOf("claude_args:", promptStart);
    expect(classifier.slice(promptStart, argsStart)).not.toContain("${{");
  });

  it("keeps the App token in read-only PR publishers and pins every action immutably", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const actionRefs = [
      ...workflow.matchAll(/^\s+uses:\s+([^\s]+)@([^\s#]+)/gm),
    ];
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const [, , ref] of actionRefs) {
      expect(ref).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(workflow).toContain(
      "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1",
    );
    expect(workflow.match(/group: formoria-agent-writer/g) ?? []).toHaveLength(
      1,
    );
    const firstWriterStart = workflow.indexOf("  cleanup-stale-branches:");
    const automaticPublisher = jobSection(
      workflow,
      "publish-automatic-pr",
      "publish-human-pr",
    );
    const humanPublisher = jobSection(workflow, "publish-human-pr");
    expect(automaticPublisher).toContain("HEALTH_AGENT_GITHUB_APP_ID");
    expect(humanPublisher).toContain("HEALTH_AGENT_GITHUB_APP_ID");
    expect(workflow.slice(0, firstWriterStart)).not.toContain(
      "HEALTH_AGENT_GITHUB_APP_PRIVATE_KEY",
    );
    for (const publisher of [automaticPublisher, humanPublisher]) {
      expect(publisher).not.toContain("group: formoria-agent-writer");
      expect(publisher).toContain(
        "permissions:\n      contents: read\n      pull-requests: read",
      );
      expect(publisher).not.toMatch(/^\s+[a-z-]+:\s+write$/m);
      expect(publisher).toContain("workflow-runtime.ts repair-result");
    }
    expect(workflow).not.toMatch(
      /SELFHEAL_PAT|SUPABASE_SERVICE_ROLE_KEY|MCP|Seer|PostHog|traffic|growth-pulse/i,
    );
  });

  it("checks out full Directory history with only required GitHub read permissions", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const directory = jobSection(
      workflow,
      "evaluate-directory",
      "sentry-triage",
    );

    expect(directory).toContain(
      "permissions:\n      contents: read\n      pull-requests: read\n      security-events: read",
    );
    expect(directory).not.toMatch(/^\s+[a-z-]+:\s+write$/m);
    expect(directory).toMatch(
      /uses: actions\/checkout@[0-9a-f]{40}[\s\S]*?with:\n\s+fetch-depth: 0\n\s+persist-credentials: false/,
    );
  });

  it("wires safe stale-branch deletion through the scoped App adapter and outside the repair queue", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const cleanup = jobSection(
      workflow,
      "cleanup-stale-branches",
      "enqueue-and-claim",
    );

    expect(cleanup).toContain("needs.gate.outputs.mode == 'live'");
    expect(cleanup).toContain("HEALTH_AGENT_GITHUB_APP_PRIVATE_KEY");
    expect(cleanup).toContain("workflow-runtime.ts cleanup-stale-branches");
    expect(cleanup).toContain(
      "--aggregate-artifact .health-agent-artifacts/aggregate.json",
    );
    expect(cleanup).toContain("stale-branch-cleanup-audit.json");
    expect(workflow).toContain(
      "needs: [gate, aggregate-and-deliver, cleanup-stale-branches]",
    );
  });

  it("escalates automatic and human batches after their two repair cycles fail", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const escalation = jobSection(
      workflow,
      "escalate-repair-failure",
      "validate-repair",
    );

    expect(escalation).toContain(
      "needs: [gate, prepare-repair-batches, automatic-repair, human-repair]",
    );
    expect(escalation).toContain(
      "needs.automatic-repair.result == 'failure' || needs.human-repair.result == 'failure'",
    );
    expect(escalation).toContain(
      'lease_owner="github-actions:${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}"',
    );
    for (const policy of ["automatic", "human"]) {
      const resultVariable = `${policy.toUpperCase()}_RESULT`;
      const failureStart = escalation.indexOf(
        `if [[ "$${resultVariable}" == "failure" ]]; then`,
      );
      const failureEnd = escalation.indexOf("\n          fi", failureStart);
      expect(failureStart).toBeGreaterThan(-1);
      expect(failureEnd).toBeGreaterThan(failureStart);
      const failureBlock = escalation.slice(failureStart, failureEnd);
      expect(failureBlock).toContain("workflow-runtime.ts repair-failure \\");
      expect(failureBlock).toContain(
        `--metadata .health-agent-artifacts/${policy}-metadata.json \\`,
      );
      expect(failureBlock).toContain(
        `--snapshot .health-agent-artifacts/${policy}-snapshot.json \\`,
      );
      expect(failureBlock).toContain(`--merge-policy ${policy} \\`);
      expect(failureBlock).toContain('--lease-owner "$lease_owner" \\');
      expect(failureBlock).toContain(
        `--output .health-agent-artifacts/failures/${policy}.json`,
      );
    }
    expect(escalation).toContain("if: always()");
    expect(escalation).toContain(
      "path: |\n            .health-agent-artifacts/failures/automatic.json\n            .health-agent-artifacts/failures/human.json",
    );
  });

  it("has a secretless validation job without provider credentials", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const secretlessStart = workflow.indexOf("  secretless-validation:");
    const nextJob = workflow.indexOf("\n  collect-link:", secretlessStart);
    const secretless = workflow.slice(secretlessStart, nextJob);
    expect(secretless).not.toContain("secrets.");
    expect(secretless).toContain("pnpm exec tsc --noEmit");
    expect(secretless).toContain("health-agent-workflow.test.ts");
  });

  it("keeps queue arbitration, repair traceability, and the retired workflow out", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    expect(workflow).toContain("enqueue-and-claim");
    expect(workflow).toContain("repair-snapshot");
    expect(workflow).toContain("repair-metadata");
    expect(workflow).toContain("repair-audit");
    expect(workflow).toContain("retention-days: 14");
    expect(workflow).toContain("BATCH_KIND: automatic");
    expect(workflow).toContain('if [[ "$BATCH_KIND" == "automatic" ]]');
    expect(workflow).toContain("directory:canary:github-app-pr");
    expect(workflow).not.toContain("directory:stale-branch:canary");
    expect(workflow).toContain("health-agent-canary");
    expect(
      (workflow.match(/validate-canary-patch\.sh/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(workflow).toContain(
      ".health-agent-artifacts/metadata/automatic-snapshot.json",
    );
    expect(
      workflow.match(/<!-- health-agent:confirmation:v1 -->/g) ?? [],
    ).toHaveLength(2);
    const humanPublisher = workflow.slice(
      workflow.indexOf("  publish-human-pr:"),
    );
    expect(humanPublisher).not.toContain("gh pr merge --auto");

    await expect(
      access(".github/workflows/health-selfheal.yml"),
    ).rejects.toThrow();
    await expect(
      access("scripts/agent-hub/health-selfheal-workflow.test.ts"),
    ).rejects.toThrow();
  });

  it("fails closed around repair artifacts and revalidates exact changed paths", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const validation = jobSection(
      workflow,
      "validate-repair",
      "publish-automatic-pr",
    );
    const automaticPublisher = jobSection(
      workflow,
      "publish-automatic-pr",
      "publish-human-pr",
    );
    const humanPublisher = jobSection(workflow, "publish-human-pr");

    expect(validation).toContain("Download repair batch metadata");
    expect(validation).not.toContain("continue-on-error");
    expect(validation).toContain('finding_count="$(jq -er');
    for (const section of [validation, automaticPublisher, humanPublisher]) {
      expect(section).toContain("validate-repair-patch.sh");
    }
    for (const publisher of [automaticPublisher, humanPublisher]) {
      expect(publisher).not.toContain("continue-on-error");
      expect(publisher).not.toContain("git add -A\n");
      expect(publisher).toContain("finding_count");
    }
  });
});
