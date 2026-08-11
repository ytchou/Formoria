import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import * as prettier from "prettier";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const execFileAsync = promisify(execFile);
const workflowPath = ".github/workflows/health-agent.yml";
const temporaryDirectories: string[] = [];
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

type ArtifactStatus = "failed" | "skipped" | "success";

async function runProductMerge(
  directoryStatus: ArtifactStatus,
  brandStatus?: ArtifactStatus,
): Promise<Record<string, unknown>> {
  const artifactRoot = await mkdtemp(
    path.join(tmpdir(), "formoria-product-merge-"),
  );
  temporaryDirectories.push(artifactRoot);

  const workflow = parseYaml(await readFile(workflowPath, "utf8")) as {
    jobs: {
      "nightly-health": {
        steps: Array<{ id?: string; run?: string }>;
      };
    };
  };
  const mergeStep = workflow.jobs["nightly-health"].steps.find(
    (step) => step.id === "product",
  );
  if (!mergeStep?.run) {
    throw new Error("product merge command is missing from workflow");
  }

  const artifact = (routine: string, status: ArtifactStatus) => ({
    collectedAt: "2026-08-08T10:00:00.000Z",
    evidence: { mode: "preflight" },
    failures: [],
    findings: [],
    routine,
    skippedActions: status === "skipped" ? [`${routine}_collection`] : [],
    status,
    version: 1,
  });
  await writeFile(
    path.join(artifactRoot, "directory-health.json"),
    `${JSON.stringify(artifact("directory-health", directoryStatus))}\n`,
  );
  if (brandStatus) {
    await writeFile(
      path.join(artifactRoot, "brand-review.json"),
      `${JSON.stringify(artifact("brand-review", brandStatus))}\n`,
    );
  }

  await execFileAsync("bash", ["-euo", "pipefail", "-c", mergeStep.run], {
    cwd: process.cwd(),
    env: { ...process.env, HEALTH_ARTIFACT_DIR: artifactRoot },
  });
  return JSON.parse(
    await readFile(path.join(artifactRoot, "directory-health.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("unified health-agent workflow contract", () => {
  it("passes --output to every workflow-runtime command", async () => {
    // The CLI builds its input object with `outputPath: requiredArgument(argv,
    // "--output")` for *every* command, before dispatch — so a step that omits
    // it dies with `invalid_runtime_input` no matter what the command needs.
    // That is how the DEV-1429 release-claims step shipped broken: it threw
    // before reaching its handler, the canary stayed leased, and the failure
    // only showed up in the step log.
    const workflow = parseYaml(await readFile(workflowPath, "utf8")) as {
      jobs: {
        "nightly-health": { steps: Array<{ name?: string; run?: string }> };
      };
    };

    const offenders = workflow.jobs["nightly-health"].steps
      .filter((step) => step.run?.includes("workflow-runtime.ts"))
      .flatMap((step) => {
        // One step may chain several runtime invocations.
        const invocations = (step.run ?? "")
          .split("workflow-runtime.ts")
          .slice(1);
        return invocations.some((invocation) => !invocation.includes("--output"))
          ? [step.name ?? "(unnamed step)"]
          : [];
      });

    expect(offenders).toEqual([]);
  });

  it("validates repairs against the claim, not the whole repository", async () => {
    // `pnpm knip` exits non-zero while any unused symbol remains anywhere in
    // the repo, but a run claims at most HEALTH_REPAIR_CLAIM_LIMIT findings.
    // Gating validation on it demanded a repo-wide clean bill of health for a
    // scoped repair, so validate could not pass while a backlog existed —
    // exactly when there is work to do. Run 31451295997 repaired 25 claimed
    // quality findings and still failed here, so review and publish never ran.
    const workflow = parseYaml(await readFile(workflowPath, "utf8")) as {
      jobs: {
        "nightly-health": { steps: Array<{ name?: string; run?: string }> };
      };
    };

    const validateSteps = workflow.jobs["nightly-health"].steps.filter((step) =>
      step.name?.includes("validate cycle"),
    );
    expect(validateSteps.length).toBeGreaterThan(0);

    for (const step of validateSteps) {
      const run = step.run ?? "";
      // A repo-wide dead-code sweep as a pass/fail gate, in any form.
      expect(run).not.toMatch(/(^|\s|&&\s*)pnpm (--silent )?knip\b/m);
      expect(run).toContain("verify-claimed-findings.sh");
    }
  });

  it("admits before collection and gates duplicate replays without workflow-wide cancellation", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    expect(workflow).not.toContain("concurrency:");
    const admission = workflow.indexOf("id: admission");
    const firstCollector = workflow.indexOf("id: link");
    expect(admission).toBeGreaterThan(-1);
    expect(admission).toBeLessThan(firstCollector);
    expect(workflow).toContain("workflow-runtime.ts admit-run");
    expect(workflow).toContain("--terminal-output");
    expect(workflow).toContain("if: steps.admission.outputs.claimed == 'true'");
    expect(workflow).toContain("id: duplicate-terminal");
  });

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

  it("passes Supabase credentials to post-publication queue transitions", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const publishStep = workflow.slice(
      workflow.indexOf(
        'name: "Stage 4 · Publish — create at most one manager-reviewed PR"',
      ),
      workflow.indexOf('name: "Stage 5 · Final manager report"'),
    );

    expect(publishStep).toContain(
      "HEALTH_AGENT_WRITER_TOKEN: ${{ secrets.HEALTH_AGENT_WRITER_TOKEN }}",
    );
    expect(publishStep).toContain(
      "NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}",
    );
  });

  it("sends only the findings report and final report and uploads one run artifact", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow.match(/initial-report\.ts/g)).toHaveLength(1);
    expect(workflow.match(/workflow-runtime\.ts final-report/g)).toHaveLength(
      1,
    );
    expect(workflow.match(/actions\/upload-artifact@/g)).toHaveLength(2);
    expect(workflow).toContain(
      "health-run-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(workflow).toContain("health-run.json");
    expect(workflow).toContain("audit.jsonl");
    expect(workflow).not.toContain("actions/download-artifact@");
  });

  it("keeps final-report runtime arguments in one folded shell command", async () => {
    const workflow = parseYaml(await readFile(workflowPath, "utf8")) as {
      jobs: {
        "nightly-health": {
          steps: Array<{ id?: string; run?: string }>;
        };
      };
    };
    const finalReport = workflow.jobs["nightly-health"].steps.find(
      (step) => step.id === "final-report",
    );

    expect(finalReport?.run).toBeDefined();
    expect(finalReport?.run).not.toContain("\n");
    for (const argument of [
      "--run-at",
      "--attempt",
      "--workflow-url",
      "--output",
      "--audit",
    ]) {
      expect(finalReport?.run).toContain(argument);
    }
  });

  it.each([
    ["success", "success", "success"],
    ["success", "skipped", "success"],
    ["success", "failed", "failed"],
    ["failed", "skipped", "failed"],
  ] as const)(
    "merges directory %s and brand %s artifacts as %s",
    async (directoryStatus, brandStatus, expectedStatus) => {
      const merged = await runProductMerge(directoryStatus, brandStatus);

      expect(merged).toMatchObject({
        failures: [],
        findings: [],
        status: expectedStatus,
      });
    },
  );

  it("fails closed when the brand review artifact is missing", async () => {
    await expect(runProductMerge("success")).rejects.toThrow();
  });

  it("classifies failed artifact uploads and gates terminal success on both attempts", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toMatch(
      /name: "Stage 5 · Upload health run"[\s\S]*?id: upload/,
    );
    expect(workflow).toContain("id: upload-retry");
    expect(workflow).toContain("record-artifact-upload");
    expect(workflow).toContain("steps.upload.outcome != 'success'");
    expect(workflow).toContain(
      '"${{ steps.upload-retry.outcome }}" == success',
    );
    expect(workflow).toContain(
      'test "${{ steps.upload.outcome }}" = success || test "${{ steps.upload-retry.outcome }}" = success',
    );
  });

  it("finalizes the claimed ledger only after required terminal delivery", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const finalize = workflow.indexOf("id: finalize\n");
    const uploadStatus = workflow.indexOf("id: upload-status\n");
    const surface = workflow.indexOf(
      'name: "Stage 5 · Surface infrastructure failures"',
    );

    expect(finalize).toBeGreaterThan(uploadStatus);
    expect(surface).toBeGreaterThan(finalize);
    const finalization = workflow.slice(finalize, surface);
    expect(finalization).toContain(
      "if: always() && steps.admission.outputs.claimed == 'true'",
    );
    for (const outcome of [
      "steps.final-report.outcome",
      "steps.artifact.outcome",
      "steps.upload.outcome",
      "steps.upload-retry.outcome",
      "steps.upload-status.outcome",
    ]) {
      expect(finalization).toContain(outcome);
    }
    expect(finalization).toContain('--status "$terminal_status"');
    expect(workflow).toContain("terminal-status");
    expect(workflow).toContain("terminal_status=failed");
    expect(workflow).toContain('"$terminal_status" == success');

    const duplicateTerminal = workflow.indexOf("id: duplicate-terminal\n");
    expect(duplicateTerminal).toBeGreaterThan(-1);
    expect(finalize).toBeGreaterThan(duplicateTerminal);
    expect(workflow.slice(duplicateTerminal, finalize)).not.toContain(
      "id: finalize\n",
    );
  });

  it("caps repair at two cycles, publishes at most one human-reviewed PR, and never merges", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow.match(/Self-heal — repair cycle [12]/g)).toHaveLength(2);
    expect(workflow.match(/gh pr create/g)).toHaveLength(1);
    expect(workflow).toContain(
      'git remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"',
    );
    expect(workflow).toContain(
      "trap 'git remote set-url origin \"$original_origin\"' EXIT",
    );
    expect(workflow).not.toContain("gh auth setup-git");
    expect(workflow).toContain("secrets.HEALTH_AGENT_GITHUB_APP_ID");
    expect(workflow).toContain("secrets.HEALTH_AGENT_GITHUB_APP_PRIVATE_KEY");
    expect(workflow).toContain("permission-contents: write");
    expect(workflow).toContain("permission-pull-requests: write");
    expect(workflow).not.toContain("secrets.HEALTH_GITHUB_APP_ID");
    expect(workflow).not.toContain("secrets.HEALTH_GITHUB_APP_PRIVATE_KEY");
    expect(workflow).toContain("--auto-merge-enabled false");
    expect(workflow).not.toMatch(/gh pr merge|--auto(?:\s|$)/i);
    expect(workflow).toContain("validate-repair-patch.sh");
    expect(workflow).toContain("manager-snapshot.json");
    expect(workflow).toContain("jq -er '.human.traceability[].changedFiles[]'");
    expect(workflow).toContain(
      'mapfile -t repair_paths < "$HEALTH_ARTIFACT_DIR/repair-paths.txt"',
    );
    expect(workflow).toContain('git add -- "${repair_paths[@]}"');
    expect(workflow).not.toContain("git add --all");
    expect(workflow.match(/--json-schema/g)).toHaveLength(4);
    expect(workflow).toContain("steps.review-decision-1.outcome");
    expect(workflow).toContain("steps.review-decision-2.outcome");
    expect(workflow).not.toMatch(
      /steps\.review-[12]\.outcome == 'success' \|\|/,
    );
    // One re-check guard per validate cycle. Widened from
    // `quality:dead-code:` to `quality:` so the same scoped verification also
    // covers full-unit-suite findings — a claimed failing test must now be
    // shown passing, not merely have `pnpm test` run somewhere in the step.
    expect(workflow.match(/startswith\("quality:"\)/g)).toHaveLength(2);
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
    ]);

    for (const workflow of workflows) {
      for (const [, ref] of workflow.matchAll(/uses:\s+[^\s]+@([^\s#]+)/g)) {
        expect(ref).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });
});
