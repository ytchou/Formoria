import type { PhaseResult } from "@/lib/types/curation";
import { auditedCall } from "@/lib/audit";
import { isLlmProviderFailure } from "../_shared/llm-call-outcome";
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
  arbitrateBrandNames,
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
 * Per-brand input to the batch, keyed by target id by the caller.
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
   * a mismatched key in a Map is a silent empty result rather than an error. The
   * slug is only the wire key the model echoes back; it is re-keyed here so no
   * caller ever sees it.
   */
  verdicts: Map<string, NameVerdict>;
  providerFailure: boolean;
};

type NamesApplication = {
  phaseResult: PhaseResult;
  patch: EnrichPatch;
};

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
export function resolveArbitratedName(
  verdict: NameVerdict | undefined,
  normalizedCandidates: NameCandidate[],
  storedName: string,
): string {
  if (!verdict) return fallbackName(normalizedCandidates, storedName);
  const normalizedChosen = normalizeCandidateValue(verdict.chosen);
  const selected = normalizedCandidates.find(
    (candidate) => candidate.value === normalizedChosen,
  );
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
 * DEV-1321 name arbitration, batched across a whole chunk.
 *
 * Exactly ONE `arbitrateBrandNames` call for every brand in `ctx.chunk` that has
 * competing candidates — it is not a per-brand phase and must not be called from
 * inside a per-brand wave. `applyNamesResult` is the per-brand half, exactly as
 * `applyDetectResult` is the per-brand half of `runDetectPhase`.
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
  const items: NameArbiterItem[] = [];
  // Built from the same `ctx.chunk` snapshot as the items themselves, so the
  // re-key below cannot drift from the keys the model was asked about.
  const brandIdBySlug = new Map<string, string>();

  for (const brand of ctx.chunk) {
    const input = candidatesByBrandId.get(brand.id);
    if (!input) continue;

    const storedName = storedNameFrom(input.candidates, brand);
    const normalized = normalizeCandidates(storedName, input.candidates);
    // The arbiter only pays when proposers actually disagree. One distinct
    // candidate is already a unanimous verdict, so those brands never reach the
    // request payload at all.
    if (normalized.length < 2) continue;

    brandIdBySlug.set(brand.slug, brand.id);
    items.push({
      slug: brand.slug,
      storedName,
      candidates: normalized,
      ...(input.snippets ? { snippets: input.snippets } : {}),
      target: { type: ctx.targetType ?? "brand", id: brand.id },
    });
  }

  if (items.length === 0) {
    ctx.onProgress?.(
      "  [NAMES] Skipped — no brand had competing name candidates",
    );
    return skippedBatch("no disagreeing candidates");
  }

  const { result: outcome, durationMs } = await timePhase(() =>
    arbitrateBrandNames(items, ctx.jobId),
  );

  // `arbitrateBrandNames` keys its results by the item's slug, which is only the
  // wire identifier the model echoes back. Re-key to the target id before
  // anything downstream sees the map — the same move `runImageSearchPhase`
  // makes, because a rename by `clean` or `detect` turns every name-keyed
  // `map.get(...)` into a silent miss.
  const verdicts = new Map<string, NameVerdict>();
  for (const [slug, verdict] of outcome.results) {
    const brandId = brandIdBySlug.get(slug);
    if (!brandId) continue;
    verdicts.set(brandId, verdict);
  }

  // Every arbitration call died at the provider: the empty result map says
  // nothing about these brands, so the phase must NOT report success. Reporting
  // `succeeded` on an empty map is precisely how 407 quota-blocked targets went
  // green on 2026-08-02. `applyNamesResult` still runs for each brand — with no
  // verdict it falls back to the `cleaned` candidate, which is the whole point
  // of the fallback existing.
  if (isLlmProviderFailure(outcome.calls)) {
    ctx.onProgress?.(
      `  [NAMES] FAILED — every one of ${outcome.calls.attempted} call(s) failed at the provider`,
    );
    return {
      phaseResult: {
        ...buildPhaseResult(
          "names",
          "failed",
          [],
          durationMs,
          `LLM provider failed all ${outcome.calls.attempted} name arbitration call(s)`,
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

  // `changedFields` is empty on the BATCH result on purpose: the per-brand
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
 * the batch above owns the wall clock.
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
