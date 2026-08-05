import type { Brand } from "@/lib/types";
import {
  CUSTOM_QUESTION_CEILING,
  buildFaqPromptHash,
  buildFaqSystemPrompt,
  composeValidators,
  eligibleFaqPresets,
  type FaqBrandContext,
  type FaqPreset,
} from "@/lib/brands/faq-presets";
import { CITY_NAMES_ZH } from "@/lib/constants/taiwan-cities";
import { getCategoryPeerStats } from "../brand-peer-stats";
import { getBrandById } from "../brands";
import {
  getBrandFaqEntries,
  upsertBrandFaqEntries,
  type BrandFaqEntryInput,
  type BrandFaqEntryRow,
  type FaqSupabase,
} from "../brand-faq";
import { buildEnrichmentUserContent } from "../description-rewrite";
import { loadPersistedScrapeText } from "./descriptions";
import {
  buildProfiledEnrichmentConfig,
  createProfiledOpenAIClient,
  profileChatParams,
} from "../llm-audit";
import { parseJson } from "../openai-client";
import { isLlmProviderFailure, noLlmCalls } from "../_shared/llm-call-outcome";
import { brandTarget, type EnrichmentTarget } from "../_shared/enrichment-target";
import type { PhaseResult } from "@/lib/types/curation";
import {
  buildPhaseResult,
  timePhase,
  type EnrichBrand,
  type EnrichPhase,
  type EnrichScrapedData,
} from "./types";

type FaqPhaseOptions = {
  brand: EnrichBrand;
  phases: EnrichPhase[];
  scrapedData: EnrichScrapedData | null;
  serpSnippets: string[];
  overwrite?: boolean;
  /**
   * A dry run reports what it would have written and writes nothing, the way
   * every other write phase does. `scripts/model-ab/` depends on it: a model
   * comparison must cost zero production rows.
   */
  dryRun?: boolean;
  target?: EnrichmentTarget;
  jobId?: string;
  supabase?: FaqSupabase;
  /** The caller's original explicit phase list, before step expansion. */
  explicitPhases?: readonly string[];
};

type FaqPhaseOutput = {
  phaseResult: PhaseResult;
  patch: Record<string, unknown>;
};

type FaqModelEntry = {
  preset_id: string;
  question_zh: string;
  answer_zh: string;
  question_en: string;
  answer_en: string;
};

type FaqModelResult = { entries: FaqModelEntry[] };
type FaqFailure = {
  presetId: string;
  locale: "zh" | "en";
  reason: string;
  measured: number;
  target: string;
};

const FAQ_PROMPT_PARAMS = {
  snippetLimit: 10,
  siteContentLimit: 4000,
};

const FAQ_SCHEMA = {
  name: "faq_entries",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            preset_id: { type: "string" },
            question_zh: { type: "string" },
            answer_zh: { type: "string" },
            question_en: { type: "string" },
            answer_en: { type: "string" },
          },
          required: [
            "preset_id",
            "question_zh",
            "answer_zh",
            "question_en",
            "answer_en",
          ],
        },
      },
    },
    required: ["entries"],
  },
} as const;

function skipped(detail: string): FaqPhaseOutput {
  return {
    phaseResult: buildPhaseResult("faq", "skipped", [], 0, undefined, detail),
    patch: {},
  };
}

/**
 * The render path localizes the city slug through the `cities` namespace
 * (`brands/[slug]/page.tsx` calls `tCities(brand.city)`), so a prompt built on
 * the raw slug (`"taipei"`) would describe the brand differently from the page
 * it is written for. next-intl's `getTranslations` needs a request scope this
 * pipeline does not have — it also runs from CLI scripts.
 *
 * The labels therefore come from a TS constant, NOT from `messages/zh-TW.json`.
 * Importing the catalog here crashed the curation worker in production
 * (`ERR_MODULE_NOT_FOUND: /app/messages/zh-TW.json`): the worker runs `tsx`
 * directly with no Next.js bundler to inline the import, and its image ships
 * `src/` and `scripts/` but not `messages/`. Route files like
 * `app/llms.txt/route.ts` can import the catalog because Next resolves it at
 * build time; anything reachable from the worker cannot.
 */
const CITY_LABELS = CITY_NAMES_ZH;

export function localizedCityLabel(
  city: string | null | undefined,
): string | null {
  if (city == null || city.trim() === "") return null;
  return CITY_LABELS[city] ?? city;
}

function toBrandContext(
  brand: Brand,
  peerStats: FaqBrandContext["peerStats"],
): FaqBrandContext {
  return { brand, cityLabel: localizedCityLabel(brand.city), peerStats };
}

function sideRenders(
  question: string | null | undefined,
  answer: string | null | undefined,
): boolean {
  return (
    question != null &&
    question.trim() !== "" &&
    answer != null &&
    answer.trim() !== ""
  );
}

/**
 * True when every authorable preset already has a stored row that renders in
 * both locales — nothing a fill-gaps run could add. Checked before the LLM call
 * because `needsPhase` returns `true` for `faq` unconditionally (entry counts
 * are not on the brand row), so without this gate every unrelated refresh pays
 * a two-attempt FAQ call whose entire output is then discarded by the
 * gap-filling branch of `upsertBrandFaqEntries`.
 */
export function faqCoverageIsComplete(
  presets: readonly FaqPreset[],
  rows: readonly BrandFaqEntryRow[],
): boolean {
  if (presets.length === 0) return true;
  const completeByPreset = new Map<string, number>();
  for (const row of rows) {
    if (!sideRenders(row.questionZh, row.answerZh)) continue;
    if (!sideRenders(row.questionEn, row.answerEn)) continue;
    completeByPreset.set(
      row.presetId,
      (completeByPreset.get(row.presetId) ?? 0) + 1,
    );
  }
  return presets.every((preset) => {
    const needed = preset.id === "custom" ? CUSTOM_QUESTION_CEILING : 1;
    return (completeByPreset.get(preset.id) ?? 0) >= needed;
  });
}

function siteContentValue(brand: EnrichBrand): string | null {
  if (brand.site_content == null) return null;
  return typeof brand.site_content === "string"
    ? brand.site_content
    : JSON.stringify(brand.site_content);
}

function contextFacts(ctx: FaqBrandContext): string {
  const brand = ctx.brand;
  return [
    `結構化品牌事實：產品類型=${brand.productType ?? "無"}；產品標籤=${brand.productTags.join("、") || "無"}；價格序位=${brand.priceRange ?? "無"}；成立年份=${brand.foundingYear ?? "無"}；城市=${ctx.cityLabel ?? brand.city ?? "無"}；MIT 狀態=${brand.mitStatus ?? "無"}`,
    `聲譽摘要：${brand.reputationSummary?.text ?? brand.reputationSummary?.textEn ?? "無"}`,
    `同類品牌比較資料：${ctx.peerStats ? JSON.stringify(ctx.peerStats) : "無"}`,
  ].join("\n");
}

/**
 * Turns the previous attempt's rejections into an instruction the model can
 * act on, the way `buildDescriptionRetryInstruction` does: a bare reason token
 * says a check failed but not by how much, and the observed consequence there
 * was a second attempt that moved in the wrong direction. Naming the preset,
 * the failed check, the measured value and the target band is what makes the
 * second call worth spending.
 */
function buildFaqRetryInstruction(failures: readonly FaqFailure[]): string {
  if (failures.length === 0) return "";
  return `\n\n## 修復上一版 FAQ\n請只修正以下明確問題後重新輸出完整 JSON；不要刪除仍合格的項目：\n${failures
    .map(
      (failure) =>
        `- preset ${failure.presetId}（${failure.locale}）：${failure.reason}；實測值 ${failure.measured}；目標區間 ${failure.target}`,
    )
    .join("\n")}`;
}

export type FaqValidationOutcome = {
  entries: BrandFaqEntryInput[];
  /**
   * Rejections a second attempt could plausibly repair — a length miss, a
   * pricing figure, a near-duplicate. Only these justify spending the retry.
   */
  failures: FaqFailure[];
  /**
   * Rejections no repair instruction can fix: the model answered a preset it
   * was never allowed to author. They are reported to the model (so it stops
   * doing it) but never force a second attempt on their own.
   */
  unrepairable: FaqFailure[];
  dropped: number;
};

function entryKey(presetId: string, position: number): string {
  return `${presetId}|${position}`;
}

/**
 * The whole accept/drop decision, exported so it can be tested without mocking
 * Supabase or any internal service (`scripts/check-test-boundaries.mjs`).
 *
 * `presets` is the *model-authorable* eligible set, never the raw catalog: an
 * entry keyed to a preset outside it is dropped rather than stored, which is
 * how the prompt-level evidence gate is enforced a second time on the way in.
 */
export function validateFaqEntries(
  result: FaqModelResult,
  presets: readonly FaqPreset[],
  ctx: FaqBrandContext,
): FaqValidationOutcome {
  const presetById = new Map(presets.map((preset) => [preset.id, preset]));
  const siblings: Record<"zh" | "en", string[]> = { zh: [], en: [] };
  const entries: BrandFaqEntryInput[] = [];
  const failures: FaqFailure[] = [];
  const unrepairable: FaqFailure[] = [];
  const takenKeys = new Set<string>();
  let dropped = 0;
  let customPosition = 0;

  for (const raw of Array.isArray(result.entries) ? result.entries : []) {
    const preset = presetById.get(raw?.preset_id);
    if (!preset) {
      dropped += 1;
      unrepairable.push({
        presetId: raw?.preset_id || "unknown",
        locale: "zh",
        reason: "preset is not eligible",
        measured: 0,
        target: "eligible preset id",
      });
      continue;
    }

    // Dropped BEFORE validation, not after. A second entry for the same
    // non-custom preset would land on `position = 0` again and make the single
    // upsert hit `brand_id,preset_id,position` twice — Postgres 21000, which
    // fails the whole phase. Validating it first would also push its answer
    // into `siblings`, so a legitimate answer elsewhere could then be rejected
    // as a near-duplicate of copy that was never stored.
    if (preset.id !== "custom" && takenKeys.has(entryKey(preset.id, 0))) {
      dropped += 1;
      continue;
    }
    // Same reason the ceiling check is here rather than after validation: an
    // over-ceiling custom is discarded either way, and validating it first only
    // pollutes `siblings` and manufactures a failure that spends the retry.
    if (preset.id === "custom" && customPosition >= CUSTOM_QUESTION_CEILING) {
      dropped += 1;
      continue;
    }

    const accepted: {
      locale: "zh" | "en";
      question: string;
      answer: string;
    }[] = [];
    for (const locale of ["zh", "en"] as const) {
      const question = (
        locale === "zh" ? raw.question_zh : raw.question_en
      )?.trim();
      const answer = (locale === "zh" ? raw.answer_zh : raw.answer_en)?.trim();
      if (!question || !answer) continue;
      const validation = composeValidators(...preset.validators)(answer, {
        locale,
        brand: ctx,
        siblings: siblings[locale],
      });
      if (!validation.ok) {
        failures.push({
          presetId: preset.id,
          locale,
          reason: validation.reason ?? "validator rejected the answer",
          measured:
            locale === "en" ? answer.split(/\s+/u).length : answer.length,
          target: locale === "en" ? "120–180 words" : "200–320 characters",
        });
        continue;
      }
      accepted.push({ locale, question, answer });
      siblings[locale].push(answer);
    }

    if (accepted.length === 0) {
      dropped += 1;
      continue;
    }
    const position = preset.id === "custom" ? customPosition++ : 0;
    takenKeys.add(entryKey(preset.id, position));
    entries.push({
      presetId: preset.id,
      position,
      questionZh:
        accepted.find((side) => side.locale === "zh")?.question ?? null,
      answerZh: accepted.find((side) => side.locale === "zh")?.answer ?? null,
      questionEn:
        accepted.find((side) => side.locale === "en")?.question ?? null,
      answerEn: accepted.find((side) => side.locale === "en")?.answer ?? null,
    });
  }

  return { entries, failures, unrepairable, dropped };
}

/** One attempt's transport. Returns the raw model content, or `ok: false`. */
export type FaqSend = (
  retryInstruction: string,
  attempt: number,
) => Promise<{ ok: boolean; content: string | null }>;

/**
 * The two-attempt validation loop, mirroring `rewriteBrandDescription`.
 *
 * The transport is injected so the loop's contract — exactly two attempts, the
 * second one carrying a repair instruction built from the first's rejections —
 * is testable without mocking Supabase or an internal service. A provider
 * failure breaks out immediately rather than burning the retry: a 429 is not a
 * quality problem and a repair instruction cannot fix it.
 */
export async function resolveFaqAttempts(
  presets: readonly FaqPreset[],
  ctx: FaqBrandContext,
  send: FaqSend,
): Promise<FaqValidationOutcome & { calls: ReturnType<typeof noLlmCalls> }> {
  const calls = noLlmCalls();
  // Keyed by `(presetId, position)` so attempt 2 replaces only what it
  // re-answers. Assigning attempt 2's entries wholesale loses attempt 1's
  // accepted answers, and "fix these" is exactly the instruction that makes a
  // model return the repaired entry alone.
  const merged = new Map<string, BrandFaqEntryInput>();
  let dropped = 0;
  let failures: FaqFailure[] = [];
  let unrepairable: FaqFailure[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await send(
      buildFaqRetryInstruction([...failures, ...unrepairable]),
      attempt,
    );
    calls.attempted += 1;
    if (!response.ok) {
      calls.providerFailed += 1;
      break;
    }
    const parsed = response.content
      ? parseJson<FaqModelResult>(response.content)
      : null;
    const validation = validateFaqEntries(
      parsed ?? { entries: [] },
      presets,
      ctx,
    );
    for (const entry of validation.entries) {
      merged.set(entryKey(entry.presetId, entry.position ?? 0), entry);
    }
    dropped = validation.dropped;
    failures = validation.failures;
    unrepairable = validation.unrepairable;
    // Only repairable failures earn the second call. An entry keyed to a preset
    // outside the authorable set cannot be fixed by a repair instruction — the
    // model was never permitted to author it — so it must not cost an attempt.
    if (failures.length === 0) break;
  }

  return {
    entries: [...merged.values()],
    dropped,
    failures,
    unrepairable,
    calls,
  };
}

type FaqRunOutcome = {
  entries: BrandFaqEntryInput[];
  dropped: number;
  calls: ReturnType<typeof noLlmCalls>;
  failed: boolean;
  /** Set when the phase ended without an LLM call and wrote nothing. */
  noop?: string;
};

export async function runFaqPhase({
  brand,
  phases,
  scrapedData,
  serpSnippets,
  overwrite,
  dryRun,
  target,
  jobId,
  supabase,
  explicitPhases,
}: FaqPhaseOptions): Promise<FaqPhaseOutput> {
  if (!phases.includes("faq")) return skipped("faq phase not requested");
  // `runEnrich` also runs against submissions, whose id has no `brands` row:
  // `getBrandById` would throw out of `timePhase` and abort the whole target
  // after descriptions and reputation already spent their calls, and an upsert
  // keyed by a submission id would violate the `brand_faq_entries` FK. A
  // submission's FAQ is authored once it is approved and the phase runs against
  // the resulting brand; the template floors render until then.
  if (target?.type === "submission")
    return skipped("faq phase does not run for submission targets");
  const token = process.env.OPENAI_API_KEY;
  if (!token) return skipped("OPENAI_API_KEY is not configured");

  const auditTarget = target ?? brandTarget(brand.id);
  // `overwrite` was declared, passed by the caller, and then dropped on the
  // floor: re-authoring must honour the caller's explicit request as well as an
  // explicitly requested `faq` phase.
  const explicitFaqPhase =
    overwrite === true || explicitPhases?.includes("faq") === true;

  const { result, durationMs } = await timePhase<FaqRunOutcome>(async () => {
    // `getBrandById` and the persisted scrape have no data dependency on each
    // other, so they run together; peer stats need the brand's product type.
    const [brandRecord, persistedScrape] = await Promise.all([
      getBrandById(brand.id),
      loadPersistedScrapeText(auditTarget),
    ]);
    const peerStats = await getCategoryPeerStats(
      brandRecord.productType,
      brandRecord.id,
      supabase,
    );
    const ctx = toBrandContext(brandRecord, peerStats);
    // A preset with a null `promptFragment` is never model-authored — its copy
    // is code-derived (taiwan-origin's MIT ladder) and is rendered from the
    // template floor. It is excluded from BOTH the prompt (which
    // `buildFaqSystemPrompt` already does) and the accepted set, or a model
    // answer keyed to it would be stored with zero validators behind it.
    // `authorable` is the preset's own answer to "does the model have enough
    // evidence to write this?", which is a stricter question than render
    // eligibility (price-positioning needs peer stats the request path lacks).
    // It defaults to `eligible` when a preset does not override it.
    const authorable = eligibleFaqPresets(ctx).filter(
      (preset) =>
        preset.promptFragment !== null && (preset.authorable?.(ctx) ?? true),
    );
    if (authorable.length === 0)
      return {
        entries: [],
        dropped: 0,
        calls: noLlmCalls(),
        failed: false,
        noop: "no model-authorable presets are eligible",
      };

    // One cheap read stands in for the LLM call a fill-gaps run would have
    // thrown away anyway.
    if (!explicitFaqPhase) {
      const stored = await getBrandFaqEntries(brand.id, supabase);
      if (faqCoverageIsComplete(authorable, stored))
        return {
          entries: [],
          dropped: 0,
          calls: noLlmCalls(),
          failed: false,
          noop: "every eligible preset already has a complete stored entry",
        };
    }

    const systemPrompt = buildFaqSystemPrompt(authorable, ctx);
    const promptHash = buildFaqPromptHash(authorable);
    const snippets = [
      ...serpSnippets,
      ...(scrapedData?.snippets ?? []),
      ...persistedScrape.snippets,
    ];
    const siteContent =
      [siteContentValue(brand), persistedScrape.siteContent]
        .filter(Boolean)
        .join("\n\n") || null;
    const content = buildEnrichmentUserContent(
      brandRecord.name,
      brandRecord.description,
      snippets,
      siteContent,
      { productCategoryZh: brandRecord.category },
    );
    const userContent = `${content.userContent}\n\n${contextFacts(ctx)}`;
    const config = buildProfiledEnrichmentConfig("faq", systemPrompt, "faq", {
      ...FAQ_PROMPT_PARAMS,
      promptHash,
    });
    const { entries: accepted, dropped, calls } = await resolveFaqAttempts(
      authorable,
      ctx,
      async (retryInstruction, attempt) => {
        const client = createProfiledOpenAIClient(
          "faq",
          { jobId, target: auditTarget, phase: "faq", attempt, config },
          { apiKey: token },
        );
        const response = await client.chat({
          system: systemPrompt,
          user: `${userContent}${retryInstruction}`,
          schema: FAQ_SCHEMA,
          ...profileChatParams("faq"),
        });
        return { ok: response.response.ok, content: response.content };
      },
    );

    if (isLlmProviderFailure(calls))
      return { entries: [], dropped, calls, failed: true };
    // A dry run still reports what it accepted; it just never writes it.
    if (accepted.length > 0 && dryRun !== true) {
      await upsertBrandFaqEntries(brand.id, accepted, {
        explicitFaqPhase,
        client: supabase,
      });
    }
    return { entries: accepted, dropped, calls, failed: false };
  });

  if (result.failed) {
    return {
      phaseResult: {
        ...buildPhaseResult(
          "faq",
          "failed",
          [],
          durationMs,
          "LLM provider failed the FAQ call",
        ),
        providerFailure: true,
      },
      patch: {},
    };
  }
  if (result.noop) {
    return {
      phaseResult: buildPhaseResult(
        "faq",
        "skipped",
        [],
        durationMs,
        undefined,
        result.noop,
      ),
      patch: {},
    };
  }
  return {
    phaseResult: buildPhaseResult(
      "faq",
      "succeeded",
      result.entries.length > 0 ? ["faq"] : [],
      durationMs,
      undefined,
      `accepted ${result.entries.length}, dropped ${result.dropped}${
        dryRun === true ? " (dry run — nothing written)" : ""
      }`,
    ),
    patch: {},
  };
}
