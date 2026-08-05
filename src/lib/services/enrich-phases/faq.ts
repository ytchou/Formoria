import type { Brand } from "@/lib/types";
import {
  CUSTOM_QUESTION_CEILING,
  buildFaqPromptHash,
  buildFaqSystemPrompt,
  eligibleFaqPresets,
  type FaqBrandContext,
  type FaqPreset,
} from "@/lib/brands/faq-presets";
import { getCategoryPeerStats } from "../brand-peer-stats";
import { getBrandById } from "../brands";
import {
  upsertBrandFaqEntries,
  type BrandFaqEntryInput,
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
import { isLlmProviderFailure, noLlmCalls } from "../llm-call-outcome";
import { brandTarget, type EnrichmentTarget } from "../enrichment-target";
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

function toBrandContext(
  brand: Brand,
  peerStats: FaqBrandContext["peerStats"],
): FaqBrandContext {
  return { brand, cityLabel: brand.city, peerStats };
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
    `結構化品牌事實：產品類型=${brand.productType ?? "無"}；產品標籤=${brand.productTags.join("、") || "無"}；價格序位=${brand.priceRange ?? "無"}；成立年份=${brand.foundingYear ?? "無"}；城市=${brand.city ?? "無"}；MIT 狀態=${brand.mitStatus ?? "無"}`,
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
export function buildFaqRetryInstruction(
  failures: readonly FaqFailure[],
): string {
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
  failures: FaqFailure[];
  dropped: number;
};

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
  let dropped = 0;
  let customPosition = 0;

  for (const raw of Array.isArray(result.entries) ? result.entries : []) {
    const preset = presetById.get(raw?.preset_id);
    if (!preset) {
      dropped += 1;
      failures.push({
        presetId: raw?.preset_id || "unknown",
        locale: "zh",
        reason: "preset is not eligible",
        measured: 0,
        target: "eligible preset id",
      });
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
      const validation = preset.validators.reduce(
        (current, validator) =>
          current.ok
            ? validator(answer, {
                locale,
                brand: ctx,
                siblings: siblings[locale],
              })
            : current,
        { ok: true } as { ok: boolean; reason?: string },
      );
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

    if (preset.id === "custom" && customPosition >= CUSTOM_QUESTION_CEILING) {
      dropped += 1;
      continue;
    }
    if (accepted.length === 0) {
      dropped += 1;
      continue;
    }
    const position = preset.id === "custom" ? customPosition++ : 0;
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

  return { entries, failures, dropped };
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
  let entries: BrandFaqEntryInput[] = [];
  let dropped = 0;
  let failures: FaqFailure[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await send(buildFaqRetryInstruction(failures), attempt);
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
    entries = validation.entries;
    dropped = validation.dropped;
    failures = validation.failures;
    if (failures.length === 0) break;
  }

  return { entries, dropped, failures, calls };
}

export async function runFaqPhase({
  brand,
  phases,
  scrapedData,
  serpSnippets,
  target,
  jobId,
  supabase,
  explicitPhases,
}: FaqPhaseOptions): Promise<FaqPhaseOutput> {
  if (!phases.includes("faq")) return skipped("faq phase not requested");
  const token = process.env.OPENAI_API_KEY;
  if (!token) return skipped("OPENAI_API_KEY is not configured");

  const auditTarget = target ?? brandTarget(brand.id);

  const { result, durationMs } = await timePhase(async () => {
    const brandRecord = await getBrandById(brand.id);
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
    const authorable = eligibleFaqPresets(ctx).filter(
      (preset) => preset.promptFragment !== null,
    );
    if (authorable.length === 0)
      return { entries: [], dropped: 0, calls: noLlmCalls(), failed: false };

    const systemPrompt = buildFaqSystemPrompt(authorable, ctx);
    const promptHash = buildFaqPromptHash(authorable);
    const persistedScrape = await loadPersistedScrapeText(auditTarget);
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
    if (accepted.length > 0) {
      await upsertBrandFaqEntries(brand.id, accepted, {
        explicitFaqPhase: explicitPhases?.includes("faq") === true,
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
  return {
    phaseResult: buildPhaseResult(
      "faq",
      "succeeded",
      result.entries.length > 0 ? ["faq"] : [],
      durationMs,
      undefined,
      `accepted ${result.entries.length}, dropped ${result.dropped}`,
    ),
    patch: {},
  };
}
