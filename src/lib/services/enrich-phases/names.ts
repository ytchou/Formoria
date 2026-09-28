import type { PhaseResult } from "@/lib/types/curation";
import { auditedCall } from "@/lib/audit";
import {
  addLlmCalls,
  isLlmProviderFailure,
  noLlmCalls,
} from "../_shared/llm-call-outcome";
import {
  ENRICH_BRAND_CONCURRENCY,
  mapWithConcurrency,
} from "../_shared/concurrency";
import {
  isBilingualBrandName,
  isTaiwanFirstBilingualBrandName,
  isValidBrandName,
} from "../brand-cleanup";
import type {
  BrandNameEvidence,
  BrandNameProposal,
} from "@/lib/types/enriched-data";
import {
  arbitrateBrandName,
  type NameArbiterItem,
  type NameCandidate,
  type NameVerdict,
} from "../name-arbiter";
import {
  buildPhaseResult,
  timePhase,
  type BatchPhaseContext,
  type EnrichBrand,
  type EnrichPatch,
} from "./types";

/**
 * Per-brand input to the phase, keyed by target id by the caller.
 *
 * `candidates` are the competing proposals collected during wave A — one each
 * from the phases that used to write `name` themselves. `snippets` are the
 * brand's SERP snippets, passed through to the arbiter item unchanged.
 */
export type NameCandidateInput = {
  candidates: NameCandidate[];
  snippets?: string[];
};

export type NamesPhaseOutput = {
  phaseResult: PhaseResult;
  /**
   * Keyed by TARGET ID, never by display name and never by slug.
   *
   * The same rule `runImageSearchPhase` follows, for the same reason: this phase
   * runs after `clean`/`detect`, either of which can rewrite a brand's name, and
   * a mismatched key in a Map is a silent empty result rather than an error.
   */
  verdicts: Map<string, NameVerdict>;
  providerFailure: boolean;
};

type NamesApplication = {
  phaseResult: PhaseResult;
  patch: EnrichPatch;
};

/** Exported so golden-eval inputs carry the same candidate list production sends. */
export function normalizeCandidates(
  storedName: string,
  candidates: NameCandidate[],
): NameCandidate[] {
  const supplied = candidates.some((candidate) => candidate.source === "stored")
    ? candidates
    : [{ source: "stored" as const, value: storedName }, ...candidates];
  const byValue = new Map<string, NameCandidate>();

  for (const candidate of supplied) {
    const value = normalizeCandidateValue(candidate.value);
    if (!value) continue;
    const existing = byValue.get(value);
    if (!existing) {
      byValue.set(value, { ...candidate, value });
      continue;
    }
    const evidence = dedupeEvidence([
      ...(existing.evidence ?? []),
      ...(candidate.evidence ?? []),
    ]);
    if (evidence.length > 0) existing.evidence = evidence;
  }

  return [...byValue.values()];
}

function normalizeCandidateValue(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, "");
}

function dedupeEvidence(evidence: BrandNameEvidence[]): BrandNameEvidence[] {
  const byKey = new Map<string, BrandNameEvidence>();
  for (const entry of evidence) {
    const key = `${entry.source}\u0000${entry.url}\u0000${entry.observedName}`;
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return [...byKey.values()];
}

/**
 * The name as it exists in the DATABASE, which is not necessarily `brand.name`.
 *
 * `applyChunkNameCleanup` mutates `brand.name` to the regex-cleaned value before
 * the batch search phases run (DEV-1279 — the SERP and image queries are built
 * from the name), while the row itself still holds the original. The caller
 * therefore always supplies an explicit `stored` candidate carrying the true DB
 * value, and that is what the arbiter's `storedName`, the confidence gate and
 * the "did the name actually change?" comparison must all use. Reading
 * `brand.name` instead would make a pending cleanup look like a no-op and leave
 * the dirty name in the row.
 */
function storedNameFrom(
  candidates: NameCandidate[],
  brand: EnrichBrand,
): string {
  return (
    candidates.find((candidate) => candidate.source === "stored")?.value ??
    brand.name ??
    ""
  );
}

function fallbackName(candidates: NameCandidate[], storedName: string): string {
  // A raw page title is the most dangerous fallback: it produced
  // `首頁 - 小朱甜點` and `74OUNCE BAGSMART 全家人的包` in the live rows. The
  // cleaned proposer is trusted before the stored name; scraped is never used.
  return (
    candidates.find((candidate) => candidate.source === "cleaned")?.value ??
    storedName
  );
}

/**
 * Confidence gate, deliberately asymmetric between stripping and adding.
 *
 * `high` is accepted either way. `medium` is accepted only when `chosen` is a
 * substring of the stored name — a pure strip that introduces no token the
 * record did not already carry. The worst case of a wrong medium strip is a
 * lost suffix, which is the failure mode the old regex cleaner already had and
 * which a human sees in review; a wrong medium *addition* silently renames a
 * brand to whatever its page title says. `partial-drop` (`Adela 愛德拉` →
 * candidate `Adela`) is the dangerous strip and the model returns it `high`, so
 * this relaxation does not reach it — `isValidBrandName` still does.
 *
 * Motivated by the 2026-08-03 DEV-1321 eval, where `aromase`
 * (`AROMASE 艾瑪絲 頭皮療癒永續品牌` → `AROMASE 艾瑪絲`) was the only medium
 * verdict in the set, was correct, and was the sole case where the fallback arm
 * scored below the raw arbiter.
 */
function isAcceptedConfidence(
  verdict: NameVerdict,
  storedName: string,
  candidate: NameCandidate,
): boolean {
  const addsBilingualIdentity =
    isBilingualBrandName(candidate.value) && !isBilingualBrandName(storedName);
  if (addsBilingualIdentity) {
    return (
      verdict.confidence === "high" &&
      isTaiwanFirstBilingualBrandName(candidate.value) &&
      (candidate.source === "official_website" ||
        candidate.source === "official_social") &&
      (candidate.evidence?.length ?? 0) > 0
    );
  }
  if (verdict.confidence === "high") return true;
  return verdict.confidence === "medium" && storedName.includes(verdict.chosen);
}

/**
 * The production acceptance rule for one verdict: take the model's answer only
 * when it is confident *and* the rename guard passes, otherwise fall back.
 *
 * Extracted so the DEV-1321 offline evaluation can score the exact bytes
 * production would ship rather than a re-typed copy of this condition that can
 * silently drift.
 */
function resolveArbitratedName(
  verdict: NameVerdict | undefined,
  normalizedCandidates: NameCandidate[],
  storedName: string,
): string {
  if (!verdict) return fallbackName(normalizedCandidates, storedName);
  const normalizedChosen = normalizeCandidateValue(verdict.chosen);
  const selected = normalizedCandidates.find(
    (candidate) => candidate.value === normalizedChosen,
  );
  // Choosing the stored name is not a rename, so no confidence gate applies. A
  // low "keep it" verdict must not fall through to the cleaned candidate, which
  // is how `02 編織工作室 02's crochet` would have shipped as `02`.
  if (selected?.source === "stored") return storedName;
  if (
    !selected ||
    !isAcceptedConfidence(verdict, storedName, selected) ||
    !isValidBrandName(selected.value, storedName)
  ) {
    return fallbackName(normalizedCandidates, storedName);
  }
  return selected.value;
}

function proposalForChosen(
  verdict: NameVerdict | undefined,
  chosen: string,
  storedName: string,
  candidates: NameCandidate[],
): BrandNameProposal | null {
  if (
    !verdict ||
    verdict.confidence !== "high" ||
    chosen === storedName ||
    !isTaiwanFirstBilingualBrandName(chosen)
  ) {
    return null;
  }
  const candidate = candidates.find((entry) => entry.value === chosen);
  const evidence = dedupeEvidence(candidate?.evidence ?? []);
  if (
    !candidate ||
    (candidate.source !== "official_website" &&
      candidate.source !== "official_social") ||
    evidence.length === 0
  ) {
    return null;
  }
  return {
    value: chosen,
    confidence: "high",
    reason: verdict.reason,
    evidence,
  };
}

function skippedBatch(detail: string): NamesPhaseOutput {
  return {
    phaseResult: buildPhaseResult("names", "skipped", [], 0, undefined, detail),
    verdicts: new Map(),
    providerFailure: false,
  };
}

/**
 * DEV-1321 name arbitration across a whole chunk.
 *
 * One `arbitrateBrandName` call per brand in `ctx.chunk` that has competing
 * candidates (DEV-1886), fanned out here. It is a chunk barrier, not a per-brand
 * phase, and must not be called from inside a per-brand wave. `applyNamesResult`
 * is the per-brand half, exactly as `applyDetectResult` is the per-brand half of
 * `runDetectPhase`.
 *
 * SINGLE-WRITER INVARIANT: this phase is the only writer of `name` in the
 * pipeline. `detect`, `clean` and `links` each used to write it and clobbered
 * each other by accident of ordering — that is how the live row `小朱甜點`
 * became `首頁 - 小朱甜點`. They now emit candidates and nothing else.
 */
export async function runNamesPhase(
  ctx: BatchPhaseContext,
  candidatesByBrandId: Map<string, NameCandidateInput>,
): Promise<NamesPhaseOutput> {
  if (!ctx.phases.includes("names")) {
    return skippedBatch("names phase not requested");
  }

  if (ctx.chunk.length === 0) {
    return skippedBatch("empty batch");
  }

  return auditedCall(
    { provider: "enrich", operation: "runNamesPhase", kind: "service" },
    async () => {
  const items: Array<{ brandId: string; item: NameArbiterItem }> = [];

  for (const brand of ctx.chunk) {
    const input = candidatesByBrandId.get(brand.id);
    if (!input) continue;

    const storedName = storedNameFrom(input.candidates, brand);
    const normalized = normalizeCandidates(storedName, input.candidates);
    // The arbiter only pays when proposers actually disagree. One distinct
    // candidate is already a unanimous verdict, so those brands never reach the
    // request payload at all.
    if (normalized.length < 2) continue;

    items.push({
      brandId: brand.id,
      item: {
        slug: brand.slug,
        storedName,
        candidates: normalized,
        ...(input.snippets ? { snippets: input.snippets } : {}),
        target: { type: ctx.targetType ?? "brand", id: brand.id },
      },
    });
  }

  if (items.length === 0) {
    ctx.onProgress?.(
      "  [NAMES] Skipped — no brand had competing name candidates",
    );
    return skippedBatch("no disagreeing candidates");
  }

  // One call per brand. Each call owns its own outcome, so one brand's failure
  // leaves the others' verdicts intact; a brand without a verdict takes the
  // `applyNamesResult` fallback.
  const { result: outcomes, durationMs } = await timePhase(() =>
    mapWithConcurrency(items, ENRICH_BRAND_CONCURRENCY, ({ item }) =>
      arbitrateBrandName(item, ctx.jobId),
    ),
  );

  // Keyed by target id, never by slug or name: a rename by `clean` or `detect`
  // turns every name-keyed `map.get(...)` into a silent miss.
  const verdicts = new Map<string, NameVerdict>();
  let calls = noLlmCalls();
  outcomes.forEach((outcome, index) => {
    calls = addLlmCalls(calls, outcome.calls);
    const brandId = items[index]?.brandId;
    if (outcome.value && brandId) verdicts.set(brandId, outcome.value);
  });

  // Every arbitration call died at the provider: the empty result map says
  // nothing about these brands, so the phase must NOT report success. Reporting
  // `succeeded` on an empty map is precisely how 407 quota-blocked targets went
  // green on 2026-08-02. `applyNamesResult` still runs for each brand — with no
  // verdict it falls back to the `cleaned` candidate, which is the whole point
  // of the fallback existing.
  if (isLlmProviderFailure(calls)) {
    ctx.onProgress?.(
      `  [NAMES] FAILED — every one of ${calls.attempted} call(s) failed at the provider`,
    );
    return {
      phaseResult: {
        ...buildPhaseResult(
          "names",
          "failed",
          [],
          durationMs,
          `LLM provider failed all ${calls.attempted} name arbitration call(s)`,
        ),
        providerFailure: true,
      },
      verdicts,
      providerFailure: true,
    };
  }

  ctx.onProgress?.(
    `  [NAMES] OK — ${verdicts.size} verdict(s) across ${items.length} disagreeing brand(s)`,
  );

  // `changedFields` is empty on the chunk result on purpose: the per-brand
  // `applyNamesResult` owns `["name"]`, so the field is attributed once per
  // target rather than once for the whole chunk.
  return {
    phaseResult: buildPhaseResult("names", "succeeded", [], durationMs),
    verdicts,
    providerFailure: false,
  };
    },
    {
      classify: (result) =>
        result.phaseResult.status === "failed"
          ? "failed"
          : result.phaseResult.status === "skipped"
            ? "empty"
            : "succeeded",
    },
  );
}

/**
 * The per-brand half of the names phase: turn one verdict into the patch that
 * persists it. Mirrors `applyDetectResult`, including the zero `durationMs` —
 * the chunk barrier above owns the wall clock.
 *
 * `verdict === undefined` is the normal path for a brand whose candidates all
 * agreed, and it is also the path a provider failure takes. Either way
 * `resolveArbitratedName` falls through to `fallbackName`, which returns the
 * `cleaned` candidate and NEVER the `scraped` one — a raw page title is the most
 * dangerous fallback there is and is exactly what produced `首頁 - 小朱甜點`.
 */
export function applyNamesResult(
  verdict: NameVerdict | undefined,
  brand: EnrichBrand,
  candidates: NameCandidate[],
): NamesApplication {
  const storedName = storedNameFrom(candidates, brand);
  const normalizedCandidates = normalizeCandidates(storedName, candidates);
  const chosen = resolveArbitratedName(
    verdict,
    normalizedCandidates,
    storedName,
  );
  const changed = chosen !== storedName;
  const proposal = proposalForChosen(
    verdict,
    chosen,
    storedName,
    normalizedCandidates,
  );

  return {
    phaseResult: buildPhaseResult(
      "names",
      "succeeded",
      changed ? ["name"] : [],
      0,
      undefined,
      changed ? `${storedName} → ${chosen}` : undefined,
    ),
    patch: changed
      ? {
          name: chosen,
          ...(proposal ? { _name_proposal: proposal } : {}),
        }
      : {},
  };
}
