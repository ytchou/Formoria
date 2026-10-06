/**
 * @formoria-script
 * purpose: Run the Editorial Producer end to end on golden briefs without Slack or Railway, answer checkpoints from fixtures, and score each run (DEV-1923)
 * class: operator
 * invoke: pnpm editorial:pilot -- --brief christmas-small-apartment [--brief <id>] [--all] [--resume <run-dir>] [--runs-dir <abs-path>] [--target production]
 * target: staging-default
 * safety: read-only
 * owner: engineering
 * prerequisites: OPENAI_API_KEY plus Supabase credentials in the target env file; a local Playwright Chromium (pnpm exec playwright install chromium).
 * notes: Spends real model money, up to US$1 per brief. Database access is reads only (catalog, prices); audit records go to each run's audit.jsonl, never to Supabase. --target production reads the real catalog. Ctrl-C interrupts the run durably; --resume <run-dir> continues it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { setAuditWriteSeam } from "@/lib/audit/emit";
import {
  evidencePacket,
  trailFile,
  trailPicks,
} from "@/lib/services/editorial-producer/delivery";
import {
  runProducer,
  validateDraft,
} from "@/lib/services/editorial-producer/run";
import { RunStore } from "@/lib/services/editorial-producer/store";
import {
  LIMITS,
  type Run,
  type Stage,
} from "@/lib/services/editorial-producer/types";
import { loadScriptTarget } from "../shared/target";

type PilotBrief = {
  id: string;
  brief: string;
  answers: Partial<Record<Stage, string>>;
  expect: {
    status: Run["status"][];
    stage?: Stage;
    maxQuestions: number;
    noDraft?: boolean;
  };
  humanAudit?: string;
};

const BRIEFS_PATH = resolve("scripts/editorial-producer/briefs.json");
const DEFAULT_RUNS_DIR = resolve(".local/editorial-producer/pilot");

async function loadBriefs(): Promise<PilotBrief[]> {
  const file = JSON.parse(await readFile(BRIEFS_PATH, "utf8")) as {
    briefs: PilotBrief[];
  };
  return file.briefs;
}

/** Question IDs are `<stage>-<uuid>` (run.ts `ask`); stages contain no hyphen. */
function questionStage(questionId: string): string {
  return questionId.split("-")[0] ?? "";
}

function questionCount(run: Run): number {
  return run.answers.length + (run.question ? 1 : 0);
}

function evaluate(run: Run, brief: PilotBrief): string[] {
  const problems: string[] = [];
  const { expect } = brief;
  if (!expect.status.includes(run.status))
    problems.push(
      `status ${run.status} not in [${expect.status.join(", ")}]` +
        (run.error ? ` (${run.error})` : ""),
    );
  if (expect.stage && run.stage !== expect.stage)
    problems.push(`stopped at stage ${run.stage}, expected ${expect.stage}`);
  if (questionCount(run) > expect.maxQuestions)
    problems.push(
      `${questionCount(run)} checkpoint questions, at most ${expect.maxQuestions} expected`,
    );
  if (expect.noDraft && run.draft)
    problems.push("produced a draft it should not have");
  if (run.budget.costUncertain) problems.push("model usage became uncertain");
  if (run.budget.costUsd > LIMITS.costUsd)
    problems.push(
      `cost US$${run.budget.costUsd} exceeds the US$${LIMITS.costUsd} cap`,
    );
  if (run.status === "ready_for_review") {
    if (!run.facts.length)
      problems.push("ready for review with no supported facts");
    problems.push(
      ...validateDraft(run).map((failure) => "ready draft fails: " + failure),
    );
  }
  return problems;
}

/**
 * Drives one store's unfinished run to a stop: answers fixture questions, one
 * per stage, and stops at the first question it has no answer for. The answer
 * transition mirrors ProducerController.command("answer"); the controller is not
 * reused because its launch path posts to Slack.
 */
async function drive(
  store: RunStore,
  id: string,
  brief: PilotBrief,
  signal: AbortSignal,
): Promise<Run> {
  for (;;) {
    const run = await runProducer(store, id, signal);
    if (run.status !== "awaiting_input" || !run.question || signal.aborted)
      return run;
    const stage = run.question.stage;
    const answered = run.answers.some(
      (answer) => questionStage(answer.questionId) === stage,
    );
    const text = brief.answers[stage];
    if (!text || answered) return run;
    console.log(`  [${brief.id}] ${stage} question: ${run.question.text}`);
    console.log(`  [${brief.id}] fixture answer: ${text}`);
    const eventId = `pilot-answer-${run.answers.length + 1}`;
    await store.update(id, (current) => {
      if (current.status !== "awaiting_input" || !current.question)
        throw new Error("Run left awaiting_input while answering");
      current.answers.push({
        questionId: current.question.id,
        questionText: current.question.text,
        text,
        eventId,
      });
      current.question = null;
      current.status = "running";
      current.processedEvents.push(eventId);
      delete current.error;
    });
  }
}

async function finish(
  store: RunStore,
  run: Run,
  brief: PilotBrief,
  wallMs: number,
): Promise<boolean> {
  if (run.trail) {
    await store.artifact(run.id, "trail.mdx", trailFile(run));
    await store.artifact(run.id, "picks.json", trailPicks(run));
  }
  await store.artifact(run.id, "evidence.md", evidencePacket(run));
  const problems = evaluate(run, brief);
  const summary = {
    briefId: brief.id,
    runId: run.id,
    runDir: join(store.root, run.id),
    pass: problems.length === 0,
    problems,
    status: run.status,
    stage: run.stage,
    error: run.error ?? null,
    questions: [
      ...run.answers.map((answer) => ({
        stage: questionStage(answer.questionId),
        question: answer.questionText ?? null,
        answer: answer.text,
      })),
      ...(run.question
        ? [
            {
              stage: run.question.stage,
              question: run.question.text,
              answer: null,
            },
          ]
        : []),
    ],
    counts: {
      candidates: run.candidates?.length ?? 0,
      exclusions: run.exclusions.length,
      sources: run.sources.length,
      facts: run.facts.length,
      claims: run.claims.length,
      reviewFailures: run.review?.failures.length ?? 0,
      openDecisions: run.review?.openDecisions.length ?? 0,
      revisions: run.budget.revisions,
    },
    usage: {
      costUsd: run.budget.costUsd,
      costUncertain: run.budget.costUncertain,
      modelAttempts: run.budget.modelAttempts,
      fetchAttempts: run.budget.fetchAttempts,
      activeSeconds: Math.round(run.budget.activeMs / 1000),
      wallSeconds: Math.round(wallMs / 1000),
    },
    humanAudit: brief.humanAudit ?? null,
  };
  await writeFile(
    join(store.root, "pilot-summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(
    `${summary.pass ? "PASS" : "FAIL"} ${brief.id}: ${run.status} at ${run.stage}; ` +
      `US$${run.budget.costUsd.toFixed(4)}, ${run.budget.modelAttempts} model / ` +
      `${run.budget.fetchAttempts} fetch attempts, ${summary.usage.activeSeconds}s active; ` +
      `${summary.counts.facts} facts, ${summary.counts.claims} claims`,
  );
  for (const problem of problems) console.log(`  - ${problem}`);
  console.log(`  artifacts: ${summary.runDir}`);
  return summary.pass;
}

function journalAuditTo(store: RunStore): void {
  // Same seam as the worker: audit records land in the run's own journal.
  setAuditWriteSeam(async (record) => {
    try {
      await store.journal(record.correlationId, { audit: record });
      return null;
    } catch (error) {
      return {
        message:
          error instanceof Error ? error.message : "Audit storage failed",
      };
    }
  });
}

async function startBrief(
  runsDir: string,
  brief: PilotBrief,
  signal: AbortSignal,
): Promise<boolean> {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const store = new RunStore(join(runsDir, `${brief.id}-${stamp}`));
  await store.initialize();
  await writeFile(
    join(store.root, "pilot-meta.json"),
    JSON.stringify({ briefId: brief.id }, null, 2),
  );
  journalAuditTo(store);
  const started = await store.start({
    requestId: `pilot:${brief.id}:${stamp}`,
    operatorSlackId: "pilot-harness",
    channelId: "pilot-harness",
    threadTs: stamp,
    brief: brief.brief,
  });
  if (!started.accepted) throw new Error("Fresh pilot store refused admission");
  console.log(`START ${brief.id} → ${join(store.root, started.run.id)}`);
  const begun = Date.now();
  const run = await drive(store, started.run.id, brief, signal);
  return finish(store, run, brief, Date.now() - begun);
}

async function resumeRun(
  storeRoot: string,
  briefs: PilotBrief[],
  signal: AbortSignal,
): Promise<boolean> {
  const store = new RunStore(resolve(storeRoot));
  const { briefId } = JSON.parse(
    await readFile(join(store.root, "pilot-meta.json"), "utf8"),
  ) as { briefId: string };
  const brief = briefs.find((item) => item.id === briefId);
  if (!brief) throw new Error("Unknown brief in pilot-meta.json: " + briefId);
  // initialize() turns a run killed mid-flight from running into interrupted.
  await store.initialize();
  journalAuditTo(store);
  const active = await store.active();
  if (!active) throw new Error("No unfinished run in " + store.root);
  if (active.status === "interrupted")
    await store.update(active.id, (current) => {
      // Mirrors ProducerController.command("resume").
      current.question = null;
      current.status = "running";
      current.processedEvents.push(`pilot-resume-${Date.now()}`);
      delete current.error;
    });
  console.log(
    `RESUME ${brief.id} (${active.status}) → ${join(store.root, active.id)}`,
  );
  const begun = Date.now();
  const run = await drive(store, active.id, brief, signal);
  return finish(store, run, brief, Date.now() - begun);
}

async function main(): Promise<void> {
  const { argv } = loadScriptTarget(
    process.argv.slice(2).filter((argument) => argument !== "--"),
  );
  const { values } = parseArgs({
    args: argv,
    options: {
      brief: { type: "string", multiple: true },
      all: { type: "boolean", default: false },
      resume: { type: "string" },
      "runs-dir": { type: "string" },
    },
  });
  const briefs = await loadBriefs();
  const runsDir = resolve(values["runs-dir"] ?? DEFAULT_RUNS_DIR);
  await mkdir(runsDir, { recursive: true, mode: 0o700 });

  const abort = new AbortController();
  process.once("SIGINT", () => {
    console.log("\nInterrupting; the run will be saved as interrupted.");
    abort.abort("worker_shutdown");
  });

  if (values.resume) {
    process.exitCode = (await resumeRun(values.resume, briefs, abort.signal))
      ? 0
      : 1;
    return;
  }
  const selected = values.all
    ? briefs
    : briefs.filter((brief) => values.brief?.includes(brief.id));
  const unknown = (values.brief ?? []).filter(
    (id) => !briefs.some((brief) => brief.id === id),
  );
  if (unknown.length || !selected.length)
    throw new Error(
      `Choose --all or --brief <id>. Known briefs: ${briefs.map((brief) => brief.id).join(", ")}`,
    );

  let passed = 0;
  for (const brief of selected) {
    if (abort.signal.aborted) break;
    if (await startBrief(runsDir, brief, abort.signal)) passed++;
  }
  console.log(`\n${passed}/${selected.length} briefs passed`);
  process.exitCode = passed === selected.length ? 0 : 1;
}

void main().catch((error) => {
  console.error(
    "[editorial-pilot] failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
