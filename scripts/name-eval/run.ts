/**
 * DEV-1321 gate: does the batched LLM name arbiter actually beat the regex
 * cleaner it would replace?
 *
 *   CURATION_EVAL_SINK=$PWD/scripts/name-eval/runs/latest.jsonl \
 *   pnpm exec tsx --env-file=.env.local scripts/name-eval/run.ts \
 *     --out scripts/name-eval/runs/latest.json
 *
 * `CURATION_EVAL_SINK` is read at module load by code under `src/`, so it must
 * be set on the command line — setting it from inside this file is too late.
 * It is mandatory here: with it set, `insertAiCallResult` diverts every audit
 * row to that JSONL file and returns *before* it constructs a Supabase client
 * (src/lib/services/ai-results.ts:139-151). Without it, this script would leave
 * `brand_ai_results` rows behind for a run that scores nothing.
 *
 * Nothing else in this script reads or writes Postgres or Storage: the corpus
 * is the committed fixture, not a query, so no Supabase credentials are needed.
 *
 * Three arms over the same labelled corpus:
 *
 *   cleaner           the incumbent. `cleanBrandName(storedName).cleanedName`,
 *                     no LLM. This is the number to beat.
 *   arbiter           `verdict.chosen` verbatim — no confidence gate, no rename
 *                     guard, no fallback. Measures raw model quality.
 *   arbiter+fallback  production semantics, via the same `resolveArbitratedName`
 *                     that `runNamesPhase` calls. This is what would ship.
 *
 * The two LLM arms share one set of batched calls: the guard is a pure function
 * of the verdict, so scoring it separately would double the spend for no signal.
 *
 * Exit code is always 0. This is a report; the gate decision is human.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { cleanBrandName } from "@/lib/services/brand-cleanup";
import {
  arbitrateBrandNames,
  type NameArbiterItem,
  type NameVerdict,
} from "@/lib/services/name-arbiter";
import {
  normalizeCandidates,
  resolveArbitratedName,
} from "@/lib/services/enrich-phases/names";
import { resolveOpenAIModel } from "@/lib/services/openai-client";
import {
  NAME_ARBITRATION_CASES,
  type NameArbitrationCase,
} from "@/lib/services/__tests__/fixtures/name-arbitration-cases";

const ARMS = ["cleaner", "arbiter", "arbiter+fallback"] as const;
type ArmName = (typeof ARMS)[number];

const KINDS = ["preserve", "strip", "casing", "reject"] as const;
type Kind = (typeof KINDS)[number];

type CaseScore = {
  id: string;
  kind: Kind;
  storedName: string;
  candidates: string[];
  answer: string | null;
  expected: string[];
  correct: boolean;
  verdict?: NameVerdict | null;
  note: string;
};

type Tally = { correct: number; total: number };

type ArmReport = {
  overall: Tally;
  byKind: Record<Kind, Tally>;
  cases: CaseScore[];
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv.at(index + 1);
}

/** The labels a case accepts. `expected` is one answer; `acceptable` is a set. */
function acceptedAnswers(testCase: NameArbitrationCase): string[] {
  return testCase.acceptable ?? (testCase.expected ? [testCase.expected] : []);
}

/**
 * Exact string equality, deliberately: no trimming and no case folding. Several
 * `casing` cases exist precisely because the incumbent re-cased a name the
 * brand owns (`一屋 1woof` → `一屋 1Woof`), so a lenient comparison would score
 * the bug as a pass.
 */
function isCorrect(answer: string | null, accepted: string[]): boolean {
  return answer !== null && accepted.includes(answer);
}

function emptyTally(): Tally {
  return { correct: 0, total: 0 };
}

function report(cases: CaseScore[]): ArmReport {
  const byKind = Object.fromEntries(
    KINDS.map((kind) => [kind, emptyTally()]),
  ) as Record<Kind, Tally>;
  const overall = emptyTally();

  for (const scored of cases) {
    overall.total += 1;
    byKind[scored.kind].total += 1;
    if (scored.correct) {
      overall.correct += 1;
      byKind[scored.kind].correct += 1;
    }
  }

  return { overall, byKind, cases };
}

const fraction = (tally: Tally): string => `${tally.correct}/${tally.total}`;

function pad(value: string, width: number): string {
  return value.length >= width
    ? value
    : value + " ".repeat(width - value.length);
}

function printTable(reports: Record<ArmName, ArmReport>): void {
  const armWidth = Math.max(...ARMS.map((arm) => arm.length));
  const columns = ["overall", ...KINDS];
  const header = `${pad("arm", armWidth)}  ${columns
    .map((column) => pad(column, 9))
    .join(" ")}`;
  console.log(`\n${header}`);
  console.log("-".repeat(header.length));

  for (const arm of ARMS) {
    const armReport = reports[arm];
    const cells = [
      fraction(armReport.overall),
      ...KINDS.map((kind) => fraction(armReport.byKind[kind])),
    ];
    console.log(
      `${pad(arm, armWidth)}  ${cells.map((cell) => pad(cell, 9)).join(" ")}`,
    );
  }
}

/**
 * The artefact a human reads to decide whether the model is wrong or the label
 * is. Only the shipping arm gets one — a per-case dump of all three is noise.
 */
function printDiff(armReport: ArmReport): void {
  const misses = armReport.cases.filter((scored) => !scored.correct);
  console.log(
    `\narbiter+fallback disagreements with the label: ${misses.length}/${armReport.overall.total}`,
  );

  for (const miss of misses) {
    console.log(`\n  [${miss.id}] (${miss.kind})`);
    console.log(`    stored:     ${miss.storedName}`);
    console.log(`    candidates: ${miss.candidates.join(" | ")}`);
    console.log(`    answer:     ${miss.answer ?? "(no verdict)"}`);
    console.log(`    expected:   ${miss.expected.join("  OR  ")}`);
    if (miss.verdict) {
      console.log(
        `    verdict:    chosen=${miss.verdict.chosen} confidence=${miss.verdict.confidence}`,
      );
      if (miss.verdict.reason)
        console.log(`    reason:     ${miss.verdict.reason}`);
    }
    console.log(`    note:       ${miss.note}`);
  }
}

async function main(): Promise<void> {
  const outPath = argValue("--out") ?? "scripts/name-eval/runs/latest.json";
  if (!process.env.CURATION_EVAL_SINK) {
    throw new Error(
      "CURATION_EVAL_SINK must be set, or LLM audit rows will be written to production",
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is required — the arbiter arms make real calls",
    );
  }

  const model = resolveOpenAIModel();
  console.log(`model: ${model}`);
  console.log(`cases: ${NAME_ARBITRATION_CASES.length}`);
  console.log(`sink:  ${process.env.CURATION_EVAL_SINK}`);

  // Candidates go through the production normaliser so the arbiter sees exactly
  // the list `runNamesPhase` would build (stored injected, duplicates dropped).
  const normalized = new Map(
    NAME_ARBITRATION_CASES.map((testCase) => [
      testCase.id,
      normalizeCandidates(testCase.storedName, testCase.candidates),
    ]),
  );

  // A synthetic target keeps the arbiter on its *audited* client — the same one
  // production uses — instead of the unaudited branch it takes when `target` is
  // absent. That is safe only because the sink diverts the insert; the id is a
  // fresh UUID that exists in no table, so nothing could be joined to it anyway.
  const items: NameArbiterItem[] = NAME_ARBITRATION_CASES.map((testCase) => ({
    slug: testCase.id,
    storedName: testCase.storedName,
    candidates: normalized.get(testCase.id) ?? testCase.candidates,
    target: { type: "brand", id: randomUUID() },
  }));

  const started = Date.now();
  const outcome = await arbitrateBrandNames(items);
  console.log(
    `arbitration: ${outcome.results.size}/${items.length} verdicts in ${Date.now() - started}ms ` +
      `(${outcome.calls.attempted} call(s), ${outcome.calls.providerFailed} provider failure(s))`,
  );

  const scores: Record<ArmName, CaseScore[]> = {
    cleaner: [],
    arbiter: [],
    "arbiter+fallback": [],
  };

  for (const testCase of NAME_ARBITRATION_CASES) {
    const accepted = acceptedAnswers(testCase);
    const candidates = normalized.get(testCase.id) ?? testCase.candidates;
    const candidateLabels = candidates.map(
      (candidate) => `${candidate.source}: ${candidate.value}`,
    );
    const verdict = outcome.results.get(testCase.id) ?? null;

    const base = {
      id: testCase.id,
      kind: testCase.kind,
      storedName: testCase.storedName,
      candidates: candidateLabels,
      expected: accepted,
      note: testCase.note,
    };

    const cleanerAnswer = cleanBrandName(testCase.storedName).cleanedName;
    scores.cleaner.push({
      ...base,
      answer: cleanerAnswer,
      correct: isCorrect(cleanerAnswer, accepted),
    });

    const rawAnswer = verdict?.chosen ?? null;
    scores.arbiter.push({
      ...base,
      answer: rawAnswer,
      correct: isCorrect(rawAnswer, accepted),
      verdict,
    });

    const guardedAnswer = resolveArbitratedName(
      verdict ?? undefined,
      candidates,
      testCase.storedName,
    );
    scores["arbiter+fallback"].push({
      ...base,
      answer: guardedAnswer,
      correct: isCorrect(guardedAnswer, accepted),
      verdict,
    });
  }

  const reports = {
    cleaner: report(scores.cleaner),
    arbiter: report(scores.arbiter),
    "arbiter+fallback": report(scores["arbiter+fallback"]),
  } satisfies Record<ArmName, ArmReport>;

  printTable(reports);
  printDiff(reports["arbiter+fallback"]);

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify(
      { ranAt: new Date().toISOString(), model, arms: reports },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${outPath}`);
}

void main().catch((error) => {
  console.error(
    "\nFAILED:",
    error instanceof Error
      ? (error.stack ?? error.message)
      : JSON.stringify(error),
  );
  // Still 0: a failed run is reported, not asserted. See the header.
  process.exitCode = 0;
});

export {};
