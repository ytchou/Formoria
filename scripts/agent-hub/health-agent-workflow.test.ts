import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import * as prettier from "prettier";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { repairClaimLimit } from "../health-agent/orchestrator";

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

type MergeFinding = { fingerprint: string; source: string; title: string };

type TrailSupplyFixture = {
  evidence?: Record<string, unknown>;
  findings?: readonly MergeFinding[];
  skippedActions?: readonly string[];
  status: ArtifactStatus;
} | null;

interface ProductMergeOptions {
  brandFindings?: readonly MergeFinding[];
  directoryFindings?: readonly MergeFinding[];
  /**
   * `null` omits trail-supply.json entirely. The trail-supply step is
   * continue-on-error, so the file is genuinely allowed to be absent and the
   * merge must degrade rather than abort.
   */
  trailSupply?: TrailSupplyFixture;
}

async function runProductMerge(
  directoryStatus: ArtifactStatus,
  brandStatus?: ArtifactStatus,
  options: ProductMergeOptions = {},
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

  const artifact = (
    routine: string,
    status: ArtifactStatus,
    findings: readonly MergeFinding[] = [],
  ) => ({
    collectedAt: "2026-08-08T10:00:00.000Z",
    evidence: { mode: "preflight" },
    failures: [],
    findings,
    routine,
    skippedActions: status === "skipped" ? [`${routine}_collection`] : [],
    status,
    version: 1,
  });
  await writeFile(
    path.join(artifactRoot, "directory-health.json"),
    `${JSON.stringify(
      artifact(
        "directory-health",
        directoryStatus,
        options.directoryFindings ?? [],
      ),
    )}\n`,
  );
  if (brandStatus) {
    await writeFile(
      path.join(artifactRoot, "brand-review.json"),
      `${JSON.stringify(
        artifact("brand-review", brandStatus, options.brandFindings ?? []),
      )}\n`,
    );
  }
  // DEV-1520: the merge slurps three artifacts. Every existing case gets a
  // clean, finding-free trail-supply fixture by default so the third input
  // never changes what those cases assert.
  const trailSupply =
    options.trailSupply === undefined
      ? { status: "success" as ArtifactStatus }
      : options.trailSupply;
  if (trailSupply) {
    const base = artifact(
      "trail-supply",
      trailSupply.status,
      trailSupply.findings ?? [],
    );
    await writeFile(
      path.join(artifactRoot, "trail-supply.json"),
      `${JSON.stringify({
        ...base,
        ...(trailSupply.evidence
          ? { evidence: trailSupply.evidence, snapshot: trailSupply.evidence }
          : {}),
        ...(trailSupply.skippedActions
          ? { skippedActions: trailSupply.skippedActions }
          : {}),
      })}\n`,
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
  it("uses only the production GitHub environment", async () => {
    const workflow = parseYaml(await readFile(workflowPath, "utf8")) as {
      jobs: {
        "nightly-health": { environment?: string };
      };
    };

    expect(workflow.jobs["nightly-health"].environment).toBe(
      "Formoria / production",
    );
  });

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
        return invocations.some(
          (invocation) => !invocation.includes("--output"),
        )
          ? [step.name ?? "(unnamed step)"]
          : [];
      });

    expect(offenders).toEqual([]);
  });

  it("constrains reviewer fingerprints to real fingerprints", async () => {
    // Run 31457318935 passed review on cycle 2 and published nothing: the
    // reviewer filled findings[].fingerprint with file paths, the publish gate
    // compared them against the snapshot's, and the mismatch failed the step.
    // `{"type":"string"}` accepted a path happily, so the action's own schema
    // validation could not catch it.
    const workflow = await readFile(workflowPath, "utf8");
    const schemas = workflow.match(/"fingerprint":\{"type":"string"[^}]*\}/g);
    // Two review schemas plus the two repair ledgers (DEV-1435) — every
    // fingerprint the agents report back is pattern-constrained.
    expect(schemas).toHaveLength(4);
    for (const schema of schemas ?? []) {
      expect(schema).toContain("pattern");
      expect(schema).toContain("cron|directory|link|quality|sentry");
    }
    // And the gate has to say why it refused, or a skipped publish is
    // indistinguishable from having nothing to publish.
    expect(
      workflow.match(/Review decision rejected the reviewer's result/g),
    ).toHaveLength(2);
  });

  it("gives the repair agent enough turns for a full claim", async () => {
    // Run 31452751135 claimed 25 findings against a 40-turn budget and died on
    // `error_max_turns` at turn 41 with the repair half-applied. Every finding
    // costs at least a Read and an Edit, so the budget has to scale with
    // HEALTH_REPAIR_CLAIM_LIMIT or raising the cap silently starves the agent.
    const workflow = parseYaml(await readFile(workflowPath, "utf8")) as {
      jobs: {
        "nightly-health": {
          steps: Array<{ name?: string; with?: { claude_args?: string } }>;
        };
      };
    };

    const repairSteps = workflow.jobs["nightly-health"].steps.filter((step) =>
      step.name?.includes("repair cycle"),
    );
    expect(repairSteps.length).toBeGreaterThan(0);

    for (const step of repairSteps) {
      const turns = Number(
        /--max-turns\s+(\d+)/.exec(step.with?.claude_args ?? "")?.[1],
      );
      // Read + Edit per finding, plus orientation and a verification pass.
      expect(turns).toBeGreaterThanOrEqual(repairClaimLimit({}) * 4);
    }
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

  it("discards out-of-scope repair edits before validation reads the tree", async () => {
    // `pnpm lint` and `tsc` are repo-wide, so a repair edit to a file in no
    // claim fails validation on a file the run had no permission to touch. Run
    // 31472080866 burned both cycles that way: the repair edited
    // src/instrumentation-client.ts and validation died at `check:audited-calls`,
    // which reads as a lint regression rather than the scope violation it was.
    // validate-repair-patch.sh asserts the same allowlist but runs last, so the
    // confusing error always fired first — hence "before", not merely "present".
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
      // Comments explain the ordering by naming the commands, so they have to
      // come out before the ordering itself can be measured.
      const run = (step.run ?? "")
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .join("\n");
      const enforce = run.indexOf("enforce-repair-scope.sh");
      expect(enforce).toBeGreaterThan(-1);
      // Every command that reads the whole working tree must come after it.
      for (const consumer of [
        "pnpm lint",
        "tsc --noEmit",
        "quality-runtime.ts",
        "vitest run",
      ]) {
        const at = run.indexOf(consumer);
        if (at === -1) continue;
        expect(at).toBeGreaterThan(enforce);
      }
    }
  });

  it("captures each repair agent's own result ledger before validating it", async () => {
    const raw = await readFile(workflowPath, "utf8");
    const workflow = parseYaml(raw) as {
      jobs: {
        "nightly-health": {
          steps: Array<{
            id?: string;
            name?: string;
            run?: string;
            with?: { claude_args?: string };
            env?: Record<string, string>;
          }>;
        };
      };
    };
    const steps = workflow.jobs["nightly-health"].steps;
    const indexOfStep = (id: string) =>
      steps.findIndex((step) => step.id === id);

    for (const cycle of [1, 2] as const) {
      // Without --json-schema the action leaves structured_output empty, so a
      // refusal leaves no trace anywhere (DEV-1435).
      const repair = steps[indexOfStep(`repair-${cycle}`)];
      const args = repair?.with?.claude_args ?? "";
      expect(args).toContain("--json-schema");
      expect(args).toContain(`"cycle":{"const":${cycle}}`);
      expect(args).toContain('"required":["fingerprint","status","summary"]');

      const capture = steps[indexOfStep(`repair-result-${cycle}`)];
      expect(capture?.env?.REPAIR_RESULT).toContain(
        `steps.repair-${cycle}.outputs.structured_output`,
      );
      expect(capture?.run).toContain(
        `capture-repair-result.sh ${cycle} "$HEALTH_ARTIFACT_DIR/repair-result-${cycle}.json"`,
      );
      // The ledger only helps if it is written before the step that reports
      // survivors, and read by it.
      expect(indexOfStep(`repair-result-${cycle}`)).toBeLessThan(
        indexOfStep(`validate-${cycle}`),
      );
      expect(steps[indexOfStep(`validate-${cycle}`)]?.run).toContain(
        `"$HEALTH_ARTIFACT_DIR/repair-result-${cycle}.json"`,
      );
    }

    expect(raw).toContain(".health-agent-artifacts/repair-result-*.json");
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
    // Pin the relationship, not the literal. #700 moved the cron into the
    // morning window and this assertion still named the old time — the schedule
    // is allowed to move, but `expected_at` computes the scheduling delay and
    // has to move with it, which is the bug a hardcoded string cannot catch.
    // (CI's unit-changed job scopes to changed files, so a workflow-only edit
    // never runs this file.)
    const cron = /- cron: "(\d+) (\d+) \* \* \*"/.exec(workflow);
    expect(cron).not.toBeNull();
    const expectedAt = /setUTCHours\((\d+),\s*(\d+),\s*0,\s*0\)/.exec(workflow);
    expect(expectedAt).not.toBeNull();
    expect([expectedAt?.[1], expectedAt?.[2]]).toEqual([cron?.[2], cron?.[1]]);
    expect(workflow).toContain("delay_seconds");
  });

  it("lets independent health groups finish and records both repository detectors", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    for (const id of [
      "link",
      "brand",
      // DEV-1520: `collectTrailSupplyArtifact` can still throw on a filesystem
      // error, and without continue-on-error that would abort the whole nightly
      // job at Stage 2 — the one failure mode nothing else here would catch.
      "trail-supply",
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

  it("passes writer credentials to the final Linear ticket writer", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const finalReportStep = workflow.slice(
      workflow.indexOf('name: "Stage 5 · Final manager report"'),
      workflow.indexOf(
        'name: "Stage 5 · Final manager report — duplicate terminal"',
      ),
    );

    expect(finalReportStep).toContain(
      "HEALTH_AGENT_READER_TOKEN: ${{ secrets.HEALTH_AGENT_READER_TOKEN }}",
    );
    expect(finalReportStep).toContain(
      "HEALTH_AGENT_WRITER_TOKEN: ${{ secrets.HEALTH_AGENT_WRITER_TOKEN }}",
    );
    expect(finalReportStep).toContain(
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

  it("merges trail supply findings deduplicated by fingerprint", async () => {
    // DEV-1520: trail supply is REPORT ONLY, so the only way a finding reaches
    // a human is by riding the merged directory artifact into Stage 3. The
    // shared fingerprint proves the union deduplicates rather than double-
    // ticketing a decayed section the directory arm already reported.
    const shared = {
      fingerprint: "directory:trail-empty-section:autumn-kitchen:tableware",
      source: "directory",
      title: "Trail section promises a slate it no longer has",
    };
    const merged = await runProductMerge("success", "success", {
      directoryFindings: [shared],
      trailSupply: {
        findings: [
          shared,
          {
            fingerprint:
              "directory:trail-orphaned-selection:retired-trail:mugs",
            source: "directory",
            title: "Trail selection points at a trail that no longer exists",
          },
        ],
        status: "success",
      },
    });

    expect(merged.status).toBe("success");
    expect(
      (merged.findings as Array<{ fingerprint: string }>).map(
        (finding) => finding.fingerprint,
      ),
    ).toEqual([
      "directory:trail-empty-section:autumn-kitchen:tableware",
      "directory:trail-orphaned-selection:retired-trail:mugs",
    ]);
  });

  it("merged status stays success when trail-supply is skipped", async () => {
    // Dormancy is the expected production state: scheduled runs check out
    // `main`, which carries no content/trails/. A skipped trail-supply artifact
    // must not fail the merged directory status, exactly as brand review's
    // skipped artifact already does not.
    const merged = await runProductMerge("success", "success", {
      trailSupply: { status: "skipped" },
    });

    expect(merged).toMatchObject({
      failures: [],
      findings: [],
      status: "success",
    });
  });

  it("keeps the brand findings when the trail supply artifact is missing", async () => {
    // Stage 3 aggregate is passed only --directory-artifact, so this merge is
    // the brand review findings' only route to a human. The trail-supply step
    // is continue-on-error, so its artifact is genuinely allowed to be absent —
    // and `jq -s` used to abort on the unopenable file, leaving
    // directory-health.json un-merged and discarding the night's brand findings
    // with nothing in failures[] naming the loss.
    const brandFinding = {
      fingerprint: "directory:brand-mit-inconsistent:acme",
      source: "directory",
      title: "Brand MIT status is inconsistent",
    };
    const merged = await runProductMerge("success", "success", {
      brandFindings: [brandFinding],
      trailSupply: null,
    });

    expect(
      (merged.findings as Array<{ fingerprint: string }>).map(
        (finding) => finding.fingerprint,
      ),
    ).toEqual(["directory:brand-mit-inconsistent:acme"]);
  });

  it("fails the merged status and names the loss when trail supply is missing", async () => {
    const merged = await runProductMerge("success", "success", {
      trailSupply: null,
    });

    expect(merged.status).toBe("failed");
    // The absent input has to be legible in the array the Stage 5 gate reads,
    // not just in the status.
    expect(merged.failures).toContain("missing_output");
  });

  it("carries the trail supply observation counts into the merged artifact", async () => {
    // trail-supply.json is not uploaded and dies with the runner, so the merge
    // is the only route these counts have into health-run.json. Without them a
    // night that observed 3 trails and found nothing is byte-identical to a
    // night that observed nothing at all.
    const merged = await runProductMerge("success", "success", {
      trailSupply: {
        evidence: {
          emptySectionCount: 0,
          findingCount: 0,
          orphanedSelectionCount: 0,
          readUnavailable: false,
          selectionsObserved: 9,
          trailsObserved: 3,
        },
        status: "success",
      },
    });

    expect(merged.evidence).toMatchObject({
      trailSupply: {
        selectionsObserved: 9,
        status: "success",
        trailsObserved: 3,
      },
    });
    expect(merged.snapshot).toMatchObject({
      trailSupply: { selectionsObserved: 9, trailsObserved: 3 },
    });
    // A namespaced key, so the trail arm can never overwrite a directory one.
    expect(merged.evidence).toMatchObject({ mode: "preflight" });
  });

  it("unions the trail supply dormancy marker into skippedActions", async () => {
    // `trail_supply_observation` is what distinguishes "the app reported
    // dormancy" from "the collector never ran", and skippedActions is the only
    // free-form list that reaches the aggregate as a routine-labelled entry.
    const merged = await runProductMerge("success", "success", {
      trailSupply: {
        evidence: {
          readUnavailable: true,
          selectionsObserved: 0,
          trailsObserved: 0,
        },
        skippedActions: ["trail_supply_observation"],
        status: "skipped",
      },
    });

    expect(merged.skippedActions).toContain("trail_supply_observation");
    expect(merged.status).toBe("success");
  });

  it("fails the merged status when trail supply failed", async () => {
    const merged = await runProductMerge("success", "success", {
      trailSupply: { status: "failed" },
    });

    expect(merged.status).toBe("failed");
  });

  it("classifies failed artifact uploads and gates terminal success on both attempts", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toMatch(
      /name: "Stage 5 · Upload health run"[\s\S]*?id: upload/,
    );
    expect(workflow).toContain("id: upload-retry");
    for (const id of ["upload", "upload-retry"]) {
      const uploadStart = workflow.indexOf(`id: ${id}\n`);
      const nextStep = workflow.indexOf("\n      - name:", uploadStart);
      const uploadBlock = workflow.slice(
        uploadStart,
        nextStep === -1 ? undefined : nextStep,
      );
      expect(uploadBlock).toContain("include-hidden-files: true");
    }
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
    expect(workflow).toContain(".github/release-flow.json");
    expect(workflow).toContain("resolve release policy");
    expect(workflow).toContain(
      '--base "${{ steps.release-flow.outputs.development_base }}"',
    );
    expect(workflow).toContain("validate-repair-patch.sh");
    expect(workflow).toContain("manager-snapshot.json");
    expect(workflow).toContain("jq -er '.human.traceability[].changedFiles[]'");
    expect(workflow).toContain(
      'mapfile -t repair_paths < "$HEALTH_ARTIFACT_DIR/repair-paths.txt"',
    );
    expect(workflow).toContain('git add -- "${repair_paths[@]}"');
    expect(workflow).not.toContain("git add --all");
    // Two Sentry classifications, two reviews, two repairs (DEV-1435).
    expect(workflow.match(/--json-schema/g)).toHaveLength(6);
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

  // Bug caught: setup or final-report can lose one destination while the
  // workflow still appears healthy because Agent Hub reporting is optional.
  it("keeps both Agent Hub destinations enabled for the dual-write window", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const setup = workflow.slice(
      workflow.indexOf("id: setup"),
      workflow.indexOf("id: admission"),
    );
    const finalReport = workflow.slice(
      workflow.indexOf("id: final-report"),
      workflow.indexOf("id: duplicate-terminal"),
    );

    for (const section of [setup, finalReport]) {
      expect(section).toContain("AGENT_HUB_DELIVERY_MODE: dual");
      expect(section).toContain(
        "AGENT_HUB_INGEST_URL: ${{ secrets.AGENT_HUB_INGEST_URL }}",
      );
      expect(section).toContain(
        "AGENT_HUB_INGEST_TOKEN: ${{ secrets.AGENT_HUB_INGEST_TOKEN }}",
      );
      expect(section).toContain(
        "AGENT_HUB_TURSO_DATABASE_URL: ${{ secrets.AGENT_HUB_TURSO_DATABASE_URL }}",
      );
      expect(section).toContain(
        "AGENT_HUB_TURSO_AUTH_TOKEN: ${{ secrets.AGENT_HUB_TURSO_AUTH_TOKEN }}",
      );
    }
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
