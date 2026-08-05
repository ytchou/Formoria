/**
 * DEV-1309 gate: does the batched LLM site-identity arbiter protect legitimate
 * links while revoking stored links that the brand does not own?
 *
 *   CURATION_EVAL_SINK=$PWD/scripts/site-identity-eval/runs/latest.jsonl \
 *   pnpm exec tsx --env-file=.env.local scripts/site-identity-eval/run.ts \
 *     --out scripts/site-identity-eval/runs/latest.json
 *
 * `CURATION_EVAL_SINK` is read at module load by code under `src/`, so it must
 * be set on the command line — setting it from inside this file is too late.
 * With it set, `insertAiCallResult` diverts every audit row to the JSONL file
 * and returns before constructing a Supabase client. Without it, this script
 * would leave audit rows behind for a run that scores nothing.
 *
 * The two arms share one set of batched calls:
 *   arbiter             raw verdict, with no confidence gate
 *   arbiter+quarantine  production semantics through `resolveQuarantine`
 *
 * Exit code is always 0. This is a report; the merge gate is the explicit
 * high-confidence false-reject count.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  arbitrateSiteIdentity,
  siteIdentityKey,
  type SiteIdentityItem,
  type SiteIdentityVerdict,
} from "@/lib/services/site-identity-arbiter";
import { resolveQuarantine } from "@/lib/services/enrich-phases/site-identity";
import type { QuarantineGroup } from "@/lib/services/enrich-phases/links";
import { resolveProfileModel } from "@/lib/constants/llm-models";
import {
  SITE_IDENTITY_CASES,
  type SiteIdentityEvalCase,
  type SiteIdentityOutcome,
} from "@/lib/services/__tests__/fixtures/site-identity-cases";

const ARMS = ["arbiter", "arbiter+quarantine"] as const;
type ArmName = (typeof ARMS)[number];
type Kind = "accept" | "reject";
type Tally = { correct: number; total: number };

type CaseScore = {
  id: string;
  kind: Kind;
  brandName: string;
  subjectUrl: string;
  answer: SiteIdentityOutcome | null;
  expected: SiteIdentityOutcome;
  correct: boolean;
  verdict: SiteIdentityVerdict | null;
  note: string;
};

type ArmReport = {
  overall: Tally;
  byKind: Record<Kind, Tally>;
  cases: CaseScore[];
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv.at(index + 1);
}

function emptyTally(): Tally {
  return { correct: 0, total: 0 };
}

function scoreReport(cases: CaseScore[]): ArmReport {
  const byKind = { accept: emptyTally(), reject: emptyTally() };
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

function fraction(tally: Tally): string {
  return `${tally.correct}/${tally.total}`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function printTable(reports: Record<ArmName, ArmReport>): void {
  const armWidth = Math.max(...ARMS.map((arm) => arm.length));
  const header = `${pad("arm", armWidth)}  overall    accept    reject`;
  console.log(`\n${header}`);
  console.log("-".repeat(header.length));
  for (const arm of ARMS) {
    const report = reports[arm];
    console.log(
      `${pad(arm, armWidth)}  ${pad(fraction(report.overall), 9)} ${pad(fraction(report.byKind.accept), 9)} ${fraction(report.byKind.reject)}`,
    );
  }
}

function printDiff(report: ArmReport): void {
  const misses = report.cases.filter((scored) => !scored.correct);
  console.log(`\narbiter+quarantine disagreements with the label: ${misses.length}/${report.overall.total}`);
  for (const miss of misses) {
    const verdict = miss.verdict;
    console.log(`\n  [${miss.id}] (${miss.kind})`);
    console.log(`    brand:       ${miss.brandName}`);
    console.log(`    subject:     ${miss.subjectUrl}`);
    console.log(`    answer:      ${miss.answer ?? "(no verdict)"}`);
    console.log(`    expected:    ${miss.expected}`);
    console.log(
      `    verdict:     owned=${verdict?.owned ?? "(none)"} confidence=${verdict?.confidence ?? "(none)"} reason=${verdict?.reason ?? "(none)"}`,
    );
    console.log(`    note:        ${miss.note}`);
  }
}

function itemFor(testCase: SiteIdentityEvalCase): SiteIdentityItem {
  // A synthetic target keeps the arbiter on its audited client, as production
  // does. This is safe only because the sink diverts the insert; the fresh UUID
  // exists in no table and cannot be joined to a real target.
  return {
    slug: testCase.id,
    brandName: testCase.brandName,
    subjectUrl: testCase.subjectUrl,
    subjectKind: testCase.subjectKind,
    target: { type: "brand", id: randomUUID() },
  };
}

async function main(): Promise<void> {
  const outPath = argValue("--out") ?? "scripts/site-identity-eval/runs/latest.json";
  if (!process.env.CURATION_EVAL_SINK) {
    throw new Error(
      "CURATION_EVAL_SINK must be set, or LLM audit rows will be written to production",
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required — the arbiter arms make real calls");
  }

  // Both profiles are reported because the arbiter can take either path: the
  // corpus goes through `siteIdentityBatch`, and any chunk that fails on content
  // (not on the provider) is retried item-by-item on `siteIdentity`. Reporting
  // only the default model would name a model this run may never call.
  const model = {
    batch: resolveProfileModel("siteIdentityBatch"),
    single: resolveProfileModel("siteIdentity"),
  };
  const items = SITE_IDENTITY_CASES.map(itemFor);
  console.log(`model: ${model.batch} (batch) / ${model.single} (per-item fallback)`);
  console.log(`cases: ${items.length}`);
  console.log(`sink:  ${process.env.CURATION_EVAL_SINK}`);

  const started = Date.now();
  const outcome = await arbitrateSiteIdentity(items, randomUUID());
  console.log(
    `arbitration: ${outcome.results.size}/${items.length} verdicts in ${Date.now() - started}ms ` +
      `(${outcome.calls.attempted} call(s), ${outcome.calls.providerFailed} provider failure(s))`,
  );

  const scores: Record<ArmName, CaseScore[]> = {
    arbiter: [],
    "arbiter+quarantine": [],
  };
  for (const testCase of SITE_IDENTITY_CASES) {
    const item = items.find(({ slug }) => slug === testCase.id);
    if (!item) throw new Error(`Missing item for ${testCase.id}`);
    const verdict = outcome.results.get(siteIdentityKey(item.slug, item.subjectUrl)) ?? null;
    const base = {
      id: testCase.id,
      kind: testCase.kind,
      brandName: testCase.brandName,
      subjectUrl: testCase.subjectUrl,
      expected: testCase.expected,
      verdict,
      note: testCase.note,
    };
    const rawAnswer: SiteIdentityOutcome | null = verdict
      ? verdict.owned === false
        ? "revoke"
        : "keep"
      : null;
    scores.arbiter.push({
      ...base,
      answer: rawAnswer,
      correct: rawAnswer === testCase.expected,
    });

    const quarantine: QuarantineGroup = {
      subjectUrl: testCase.subjectUrl,
      subjectKind: testCase.subjectKind,
      columns: testCase.columns,
      evidence: {},
    };
    // Score the production bytes: resolveQuarantine owns the confidence rule.
    const decision = resolveQuarantine(verdict ?? undefined, quarantine);
    const guardedAnswer: SiteIdentityOutcome = decision.revoked ? "revoke" : "keep";
    scores["arbiter+quarantine"].push({
      ...base,
      answer: guardedAnswer,
      correct: guardedAnswer === testCase.expected,
    });
  }

  const reports = {
    arbiter: scoreReport(scores.arbiter),
    "arbiter+quarantine": scoreReport(scores["arbiter+quarantine"]),
  } satisfies Record<ArmName, ArmReport>;
  printTable(reports);
  printDiff(reports["arbiter+quarantine"]);

  const highConfidenceFalseRejects = reports["arbiter+quarantine"].cases.filter(
    (scored) => scored.kind === "accept" && scored.answer === "revoke",
  );
  // This is the number that gates the merge.
  console.log("\n=== MERGE GATE: HIGH-CONFIDENCE FALSE REJECTS ===");
  console.log(`count: ${highConfidenceFalseRejects.length}`);
  for (const scored of highConfidenceFalseRejects) {
    console.log(`  ${scored.id}  ${scored.subjectUrl}`);
  }
  console.log("=== END MERGE GATE ===");

  // The accept/reject split is structural in the JSON, not something a reader
  // has to filter for: the two arms mean opposite things per section, and the
  // accept section is the one that gates the merge.
  const split = (kind: Kind) => ({
    tally: Object.fromEntries(ARMS.map((arm) => [arm, reports[arm].byKind[kind]])),
    cases: Object.fromEntries(
      ARMS.map((arm) => [arm, reports[arm].cases.filter((scored) => scored.kind === kind)]),
    ),
  });
  const json = {
    ranAt: new Date().toISOString(),
    model,
    arms: reports,
    accept: split("accept"),
    reject: split("reject"),
    highConfidenceFalseRejects: {
      count: highConfidenceFalseRejects.length,
      caseIds: highConfidenceFalseRejects.map(({ id }) => id),
    },
  };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(json, null, 2));
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
