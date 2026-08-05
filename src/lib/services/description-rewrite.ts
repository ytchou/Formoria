import {
  PURCHASE_CHANNELS,
  type PurchaseChannel,
  type PurchaseChannelCamelField,
  type PurchaseChannelKey,
} from "@/lib/brands/purchase-channels";
import { DESCRIPTION_SYSTEM_PROMPT } from "@/lib/prompts";
import { parseJson } from "./openai-client";
import {
  buildProfiledEnrichmentConfig,
  createProfiledOpenAIClient,
  profileChatParams,
  type LlmAuditContext,
} from "./llm-audit";
import { validateLocalizedText, detectAiArtifacts } from "./enrich-validators";
import {
  containsCjk,
  localizeToTW,
  stripAiToolArtifacts,
} from "./taiwan-localization";
import { noLlmCalls, type LlmCallCounts } from "./llm-call-outcome";

const ZH_DESCRIPTION_BAND = [150, 400] as const;
const EN_DESCRIPTION_BAND = [300, 700] as const;
const ZH_BLURB_BAND = [40, 80] as const;
const EN_BLURB_BAND = [60, 150] as const;

/**
 * Prompt-facing display labels for the purchase channels. The registry supplies
 * the field list and order; the Han-character labels stay local to this server
 * module so the project's hardcoded-CJK guard keeps passing on the registry.
 */
const PURCHASE_CHANNEL_PROMPT_LABELS: Record<PurchaseChannelKey, string> = {
  website: "官方購買網站",
  pinkoi: "Pinkoi",
  shopee: "蝦皮",
  myship: "7-ELEVEN 賣貨便",
};

function localizeZhText(text: string): string {
  return containsCjk(text) ? localizeToTW(text).text : text;
}

/** Copy-only output; FAQ is owned by the final dedicated enrichment phase. */
export type DescriptionRewriteResult = {
  description_zh: string | null;
  description_en: string | null;
  description: string | null;
  blurb_zh: string | null;
  blurb_en: string | null;
  validationRejections: Array<{
    field: "description_zh" | "description_en" | "blurb_zh" | "blurb_en";
    reasons: string[];
    warnings: string[];
    attempt: number;
  }>;
  rejected?: { tag: string; reason: string }[];
  crossBranch?: string[];
  rawResponse?: unknown;
};

/** Extra evidence the stage-2 listing decision needs but the description text does not. */
export type DescriptionEvidence = {
  links?: {
    socialInstagram?: string | null;
    socialThreads?: string | null;
    socialFacebook?: string | null;
  } & { [K in PurchaseChannelCamelField]?: string | null };
  productCategoryZh?: string | null;
  /** Alt text of the brand's classified images — direct evidence that physical products exist. */
  imageAlts?: string[];
};

export type EnrichmentUserContent = {
  userContent: string;
  sanitizedSnippets: string[];
  sanitizedSiteContent: string | null;
};

/**
 * The single user message the facts call and the copy call both send.
 *
 * Built once per phase and reused verbatim, so the two calls reason over
 * byte-identical evidence: a listing verdict extracted from one set of snippets
 * and a description written from another would be a silent inconsistency, and
 * assembling it twice is also how the sanitisation rules drift apart.
 */
export function buildEnrichmentUserContent(
  brandName: string,
  existingDescription: string | null,
  snippets: string[],
  siteContent: string | null,
  evidence?: DescriptionEvidence,
): EnrichmentUserContent {
  const sanitizedSnippets = snippets.slice(0, 10).map(stripAiToolArtifacts);
  const sanitizedSiteContent = siteContent
    ? stripAiToolArtifacts(siteContent)
    : null;

  // Stage-2 listing evidence. Appended, never interleaved: the four fields above
  // are the description inputs and their labels are what the tuned prompt reads.
  // Purchase channels and image alt text cannot be inferred from prose, so the
  // listing verdict is only as good as these lines.
  const purchaseEntry = (
    channel: PurchaseChannel,
  ): [string, string | null | undefined] => [
    PURCHASE_CHANNEL_PROMPT_LABELS[channel.key],
    evidence?.links?.[channel.camel],
  ];
  // Line order is prompt-visible, so it is preserved verbatim: the brand's own
  // site leads, socials sit in the middle, marketplaces close. This relies on
  // the registry's documented order invariant (`website` is always first).
  const [ownSiteChannel, ...marketplaceChannels] = PURCHASE_CHANNELS;
  const labelledLinks: Array<[string, string | null | undefined]> = [
    purchaseEntry(ownSiteChannel),
    ["Instagram", evidence?.links?.socialInstagram],
    ["Threads", evidence?.links?.socialThreads],
    ["Facebook", evidence?.links?.socialFacebook],
    ...marketplaceChannels.map(purchaseEntry),
  ];
  const linkLines = labelledLinks.flatMap(([label, url]) =>
    typeof url === "string" && url.trim().length > 0
      ? [`- ${label}：${url.trim()}`]
      : [],
  );
  const imageAlts = (evidence?.imageAlts ?? [])
    .filter(
      (alt): alt is string => typeof alt === "string" && alt.trim().length > 0,
    )
    .map((alt) => `- ${stripAiToolArtifacts(alt.trim())}`);

  const userContent = [
    `品牌名稱：${brandName}`,
    existingDescription ? `現有描述：${existingDescription}` : "",
    sanitizedSnippets.length > 0
      ? `搜尋摘要：\n${sanitizedSnippets.join("\n")}`
      : "",
    sanitizedSiteContent ? `網站內容：\n${sanitizedSiteContent}` : "",
    linkLines.length > 0 ? `品牌連結：\n${linkLines.join("\n")}` : "",
    evidence?.productCategoryZh
      ? `商品分類：${evidence.productCategoryZh}`
      : "",
    imageAlts.length > 0 ? `商品圖片描述：\n${imageAlts.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { userContent, sanitizedSnippets, sanitizedSiteContent };
}

type DescriptionAttemptInput = {
  brandName: string;
  existingDescription: string | null;
  snippets: string[];
  siteContent: string | null;
};

export type DescriptionAttempt = {
  attempt: number;
  input: DescriptionAttemptInput;
  rawResponse: unknown;
  parsed: DescriptionRewriteResult;
  validationRejections: DescriptionRewriteResult["validationRejections"];
  latencyMs: number;
  config: unknown;
};

export type DescriptionRewriteOutput = {
  /**
   * Null when no attempt produced a usable payload. Callers must read `calls`
   * to learn WHY: a provider outage and a model that answered with an empty
   * body are the same `null` here, and conflating them is what recorded 407
   * quota-failed targets as `succeeded` on 2026-08-02.
   */
  result: DescriptionRewriteResult | null;
  attempts: DescriptionAttempt[];
  calls: LlmCallCounts;
};

const EMPTY_DESCRIPTION_RESULT: DescriptionRewriteResult = {
  description_zh: null,
  description_en: null,
  description: null,
  blurb_zh: null,
  blurb_en: null,
  validationRejections: [],
};

export function parseDescriptionRewriteResult(
  content: string,
): DescriptionRewriteResult {
  const parsed = parseJson<Record<string, unknown>>(content);

  if (!parsed) {
    return { ...EMPTY_DESCRIPTION_RESULT };
  }

  const rawDescriptionZh = parsed.description_zh ?? parsed.description;
  const rawDescriptionEn = parsed.description_en;
  const descriptionZh =
    typeof rawDescriptionZh === "string" && rawDescriptionZh.trim().length > 0
      ? rawDescriptionZh.trim()
      : null;
  const descriptionEn =
    typeof rawDescriptionEn === "string" && rawDescriptionEn.trim().length > 0
      ? rawDescriptionEn.trim()
      : null;

  const rawBlurbZh = parsed.blurb_zh;
  const rawBlurbEn = parsed.blurb_en;
  const blurbZh =
    typeof rawBlurbZh === "string" && rawBlurbZh.trim().length > 0
      ? rawBlurbZh.trim()
      : null;
  const blurbEn =
    typeof rawBlurbEn === "string" && rawBlurbEn.trim().length > 0
      ? rawBlurbEn.trim()
      : null;

  return {
    description_zh: descriptionZh,
    description_en: descriptionEn,
    description: descriptionZh,
    blurb_zh: blurbZh,
    blurb_en: blurbEn,
    validationRejections: [],
  };
}

function validateDescriptionFields(
  parsed: DescriptionRewriteResult,
  attempt: number,
  brandName?: string | null,
): DescriptionRewriteResult {
  const validationRejections: DescriptionRewriteResult["validationRejections"] =
    [];
  let descriptionZh = parsed.description_zh;
  let descriptionEn = parsed.description_en;
  let blurbZh = parsed.blurb_zh;
  let blurbEn = parsed.blurb_en;

  const rejectAiArtifacts = (
    field: DescriptionRewriteResult["validationRejections"][number]["field"],
    value: string,
    locale: "zh" | "en",
  ): string | null => {
    const artifacts = detectAiArtifacts(value, locale);
    if (artifacts.length > 0) {
      validationRejections.push({
        field,
        reasons: artifacts,
        warnings: [],
        attempt,
      });
      return null;
    }
    return value;
  };

  const rejectPricingInformation = (
    field: DescriptionRewriteResult["validationRejections"][number]["field"],
    value: string,
    locale: "zh" | "en",
  ): string | null => {
    if (!containsPricingInformation(value, locale)) return value;
    validationRejections.push({
      field,
      reasons: ["pricing_information"],
      warnings: [],
      attempt,
    });
    return null;
  };

  if (descriptionZh) {
    const validation = validateLocalizedText(
      descriptionZh,
      "zh",
      ZH_DESCRIPTION_BAND,
      brandName,
    );
    const hasHardFailure = !validation.ok;
    const hasWarnings = validation.warnings.length > 0;
    if (hasHardFailure || hasWarnings) {
      validationRejections.push({
        field: "description_zh",
        reasons: validation.reasons,
        warnings: validation.warnings,
        attempt,
      });
    }
    if (hasHardFailure) {
      descriptionZh = null;
    }
    if (descriptionZh) {
      descriptionZh = rejectAiArtifacts("description_zh", descriptionZh, "zh");
    }
    if (descriptionZh) {
      descriptionZh = rejectPricingInformation(
        "description_zh",
        descriptionZh,
        "zh",
      );
    }
  } else {
    validationRejections.push({
      field: "description_zh",
      reasons: ["missing"],
      warnings: [],
      attempt,
    });
  }

  if (descriptionEn) {
    const validation = validateLocalizedText(
      descriptionEn,
      "en",
      EN_DESCRIPTION_BAND,
    );
    const hasHardFailure = !validation.ok;
    const hasWarnings = validation.warnings.length > 0;
    if (hasHardFailure || hasWarnings) {
      validationRejections.push({
        field: "description_en",
        reasons: validation.reasons,
        warnings: validation.warnings,
        attempt,
      });
    }
    if (hasHardFailure) {
      descriptionEn = null;
    }
    if (descriptionEn) {
      descriptionEn = rejectAiArtifacts("description_en", descriptionEn, "en");
    }
    if (descriptionEn) {
      descriptionEn = rejectPricingInformation(
        "description_en",
        descriptionEn,
        "en",
      );
    }
  } else {
    validationRejections.push({
      field: "description_en",
      reasons: ["missing"],
      warnings: [],
      attempt,
    });
  }

  if (blurbZh) {
    const validation = validateLocalizedText(
      blurbZh,
      "zh",
      ZH_BLURB_BAND,
      brandName,
    );
    const hasHardFailure = !validation.ok;
    const hasWarnings = validation.warnings.length > 0;
    if (hasHardFailure || hasWarnings) {
      validationRejections.push({
        field: "blurb_zh",
        reasons: validation.reasons,
        warnings: validation.warnings,
        attempt,
      });
    }
    if (hasHardFailure) {
      blurbZh = null;
    }
    if (blurbZh) {
      blurbZh = rejectAiArtifacts("blurb_zh", blurbZh, "zh");
    }
    if (blurbZh) {
      blurbZh = rejectPricingInformation("blurb_zh", blurbZh, "zh");
    }
  } else {
    validationRejections.push({
      field: "blurb_zh",
      reasons: ["missing"],
      warnings: [],
      attempt,
    });
  }

  if (blurbEn) {
    const validation = validateLocalizedText(blurbEn, "en", EN_BLURB_BAND);
    const hasHardFailure = !validation.ok;
    const hasWarnings = validation.warnings.length > 0;
    if (hasHardFailure || hasWarnings) {
      validationRejections.push({
        field: "blurb_en",
        reasons: validation.reasons,
        warnings: validation.warnings,
        attempt,
      });
    }
    if (hasHardFailure) {
      blurbEn = null;
    }
    if (blurbEn) {
      blurbEn = rejectAiArtifacts("blurb_en", blurbEn, "en");
    }
    if (blurbEn) {
      blurbEn = rejectPricingInformation("blurb_en", blurbEn, "en");
    }
  } else {
    validationRejections.push({
      field: "blurb_en",
      reasons: ["missing"],
      warnings: [],
      attempt,
    });
  }

  return {
    ...parsed,
    description_zh: descriptionZh,
    description_en: descriptionEn,
    description: descriptionZh,
    blurb_zh: blurbZh,
    blurb_en: blurbEn,
    validationRejections,
  };
}

function containsPricingInformation(
  value: string,
  locale: "zh" | "en",
): boolean {
  const sentences = value.split(locale === "zh" ? /[。！？]/u : /[.!?]+\s+/u);
  return sentences.some((sentence) => {
    if (locale === "zh") {
      if (
        /(?:價格|價位|價錢|售價|定價|加價|平價|中價|高價|低價|千元即可入手|不再昂貴|折扣|優惠|促銷|特價|買一送一|滿額)/u.test(
          sentence,
        )
      ) {
        return true;
      }
      const hasMoney = /(?:NT[$.]?|TWD|新台幣|台幣)\s*[\d,]+|[\d,]+\s*元/u.test(
        sentence,
      );
      const isNonPricingAmount =
        /(?:保險|理賠|集資|募資|銷售額|業績|佳績)/u.test(sentence);
      return hasMoney && !isNonPricingAmount;
    }

    if (
      /\b(?:prices?|priced|pricing|affordable|budget(?:-friendly)?|discount(?:ed|s)?|promotion(?:al|s)?)\b|\b(?:on sale|sale price)\b/iu.test(
        sentence,
      )
    ) {
      return true;
    }
    const hasMoney = /(?:NT\$|TWD|US\$|\$)\s*[\d,]+/iu.test(sentence);
    const isNonPricingAmount =
      /\b(?:insurance|insured|coverage|crowdfunding|fundraising|raised|sales|revenue)\b/iu.test(
        sentence,
      );
    return hasMoney && !isNonPricingAmount;
  });
}

const RETRY_FIELD_BANDS = {
  description_zh: ZH_DESCRIPTION_BAND,
  description_en: EN_DESCRIPTION_BAND,
  blurb_zh: ZH_BLURB_BAND,
  blurb_en: EN_BLURB_BAND,
} as const;

const RETRY_FIELD_UNITS: Record<keyof typeof RETRY_FIELD_BANDS, string> = {
  description_zh: "字",
  description_en: "characters",
  blurb_zh: "字",
  blurb_en: "characters",
};

/** Non-length rejection reasons, mapped to the edit that actually clears them. */
const RETRY_REASON_GUIDANCE: Record<string, string> = {
  language_purity:
    "語言不純：請全文改為該欄位指定語言，且連續拉丁字母單詞不可超過 2 個（外文專有名詞請改寫為中文或用《》括住）",
  pricing_information:
    "含價格資訊：請移除所有售價、金額、價位級距、折扣與促銷描述",
  missing: "欄位缺漏：必須輸出此欄位",
  parse_failed: "無法解析：請只輸出單一 JSON 物件，不要加上說明文字或 Markdown",
};

/**
 * Turns the previous attempt's rejections into instructions the model can act on.
 *
 * The old retry passed `JSON.stringify(rejections)` verbatim, so a length miss
 * arrived as the bare token `length_band` — which says a bound was crossed but
 * not which one. Observed consequence: the model assumed "too long" and cut
 * further, so attempt 2 came back shorter than attempt 1 (125 字 -> 101 字,
 * 230 字 -> 111 字) and failed the same check again. Naming the measured length,
 * the target band, and the direction is what makes the second call worth
 * spending.
 */
export function buildDescriptionRetryInstruction(
  rejections: DescriptionRewriteResult["validationRejections"],
  parsed: Partial<Record<keyof typeof RETRY_FIELD_BANDS, string | null>> | null,
): string {
  // Only hard failures nulled a field; warnings kept their value and need no edit.
  const hardFailures = rejections.filter(
    (rejection) => rejection.reasons.length > 0,
  );
  if (hardFailures.length === 0) return "";

  const notesByField = new Map<string, Set<string>>();
  for (const rejection of hardFailures) {
    const notes = notesByField.get(rejection.field) ?? new Set<string>();
    for (const reason of rejection.reasons) {
      if (reason === "length_band") {
        const band = RETRY_FIELD_BANDS[rejection.field];
        const unit = RETRY_FIELD_UNITS[rejection.field];
        const value = parsed?.[rejection.field];
        const length = typeof value === "string" ? value.length : null;
        if (length === null) {
          notes.add(`長度不符：必須介於 ${band[0]}-${band[1]} ${unit}`);
        } else if (length < band[0]) {
          notes.add(
            `長度不足：目前 ${length} ${unit}，少於下限 ${band[0]}，請「增加」至少 ${band[0] - length} ${unit}（目標 ${band[0]}-${band[1]} ${unit}）。` +
              `補字數請「多寫一個具體面向」——代表產品與品項細節、材料與工藝、製程或生產地、通路與販售方式、創辦背景與年份、所在城市、外界評價；` +
              `不可加形容詞或「用心」「堅持」「品質保證」這類無資訊句子，那會觸發套話檢查而同樣作廢`,
          );
        } else {
          notes.add(
            `長度超標：目前 ${length} ${unit}，超過上限 ${band[1]}，請「刪減」至少 ${length - band[1]} ${unit}（目標 ${band[0]}-${band[1]} ${unit}）`,
          );
        }
        continue;
      }
      notes.add(RETRY_REASON_GUIDANCE[reason] ?? `未通過檢查：${reason}`);
    }
    notesByField.set(rejection.field, notes);
  }

  const lines = [...notesByField.entries()].map(
    ([field, notes]) => `- ${field}：${[...notes].join("；")}`,
  );

  return [
    "\n\n前一次輸出未通過品質檢查，請只修正以下欄位，其餘欄位維持原樣：",
    ...lines,
    "注意：description_zh 必須全文繁體中文，description_en 必須全文英文（品牌中文名可保留）。兩者獨立撰寫，不可只產出其中一種語言。",
  ].join("\n");
}

/** Prompt-shaping params — stored in the audit contract, not sent as request params. */
const DESCRIPTION_PROMPT_PARAMS = {
  snippetLimit: 10,
  siteContentLimit: 4000,
  descZhBand: ZH_DESCRIPTION_BAND,
  descEnBand: EN_DESCRIPTION_BAND,
  blurbZhBand: ZH_BLURB_BAND,
  blurbEnBand: EN_BLURB_BAND,
};

export async function rewriteBrandDescription(
  brandName: string,
  existingDescription: string | null,
  snippets: string[],
  siteContent: string | null,
  audit: Pick<LlmAuditContext, "jobId" | "target">,
  evidence?: DescriptionEvidence,
): Promise<DescriptionRewriteOutput | null> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return null;
  if (snippets.length === 0 && !existingDescription) return null;

  const { userContent, sanitizedSnippets, sanitizedSiteContent } =
    buildEnrichmentUserContent(
      brandName,
      existingDescription,
      snippets,
      siteContent,
      evidence,
    );

  const attemptInput: DescriptionAttemptInput = {
    brandName,
    existingDescription,
    snippets: sanitizedSnippets,
    siteContent: sanitizedSiteContent,
  };
  const attemptConfig = buildProfiledEnrichmentConfig(
    "descriptions",
    DESCRIPTION_SYSTEM_PROMPT,
    "descriptions",
    DESCRIPTION_PROMPT_PARAMS,
  );

  let bestResult: DescriptionRewriteResult | null = null;
  let acceptedDescriptionZh: string | null = null;
  let acceptedDescriptionEn: string | null = null;
  let acceptedBlurbZh: string | null = null;
  let acceptedBlurbEn: string | null = null;
  const allValidationRejections: DescriptionRewriteResult["validationRejections"] =
    [];
  const attempts: DescriptionAttempt[] = [];
  const localizeAcceptedZh = (value: string | null): string | null =>
    value ? localizeToTW(value, { brandName }).text : null;

  // The retry needs the previous attempt's own text to measure, so the pre-validation
  // parse is carried forward rather than the accumulated (already nulled) result.
  let lastRejections: DescriptionRewriteResult["validationRejections"] = [];
  let lastParsed: DescriptionRewriteResult | null = null;

  // Counted across BOTH attempts of the loop below. A first attempt the model
  // answered and a second that hit a spent account is not an outage — only a
  // brand whose every call died at the provider may fail its target.
  const calls = noLlmCalls();

  try {
    for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
      const retryInstruction =
        attemptIndex === 0
          ? ""
          : buildDescriptionRetryInstruction(lastRejections, lastParsed);

      const startAt = Date.now();
      const client = createProfiledOpenAIClient(
        "descriptions",
        {
          ...audit,
          phase: "descriptions",
          attempt: attemptIndex + 1,
          config: attemptConfig,
        },
        { apiKey: token },
      );
      const { response, data, content } = await client.chat({
        system: DESCRIPTION_SYSTEM_PROMPT,
        user: `${userContent}${retryInstruction}`,
        json: true,
        ...profileChatParams("descriptions"),
      });
      const latencyMs = Date.now() - startAt;
      calls.attempted += 1;

      // The ONLY provider-failure site in this function. A non-2xx means the
      // call never reached the model; everything below this point is the model
      // having answered, however uselessly.
      if (!response.ok) {
        calls.providerFailed += 1;
        console.error(
          `  → description rewrite failed: HTTP ${response.status}`,
        );
        return { result: null, attempts, calls };
      }

      // Provider answered with an empty body. Deliberately NOT counted as a
      // provider failure: the account is alive and the phase must stay
      // `succeeded`/`skipped` exactly as it did before Gate C existed.
      if (!content) {
        console.error(
          `  → description rewrite: empty response, data=${JSON.stringify(data).slice(0, 200)}`,
        );
        return { result: null, attempts, calls };
      }

      const parsed = parseJson<Record<string, unknown>>(content);
      if (!parsed) {
        attempts.push({
          attempt: attemptIndex + 1,
          input: attemptInput,
          rawResponse: data,
          parsed: parseDescriptionRewriteResult("{}"),
          validationRejections: [
            {
              field: "description_zh" as const,
              reasons: ["parse_failed"],
              warnings: [],
              attempt: attemptIndex + 1,
            },
          ],
          latencyMs,
          config: attemptConfig,
        });

        if (attemptIndex === 0) {
          continue;
        }

        const emptyResult: DescriptionRewriteResult = {
          ...EMPTY_DESCRIPTION_RESULT,
          rawResponse: data,
        };
        return { result: emptyResult, attempts, calls };
      }

      const parsedResult = parseDescriptionRewriteResult(content);
      const validated = validateDescriptionFields(
        parsedResult,
        attemptIndex + 1,
        brandName,
      );

      attempts.push({
        attempt: attemptIndex + 1,
        input: attemptInput,
        rawResponse: data,
        parsed: parsedResult,
        validationRejections: validated.validationRejections,
        latencyMs,
        config: attemptConfig,
      });

      allValidationRejections.push(...validated.validationRejections);
      lastRejections = validated.validationRejections;
      lastParsed = parsedResult;
      acceptedDescriptionZh ??= localizeAcceptedZh(validated.description_zh);
      acceptedDescriptionEn ??= validated.description_en;
      acceptedBlurbZh ??= localizeAcceptedZh(validated.blurb_zh);
      acceptedBlurbEn ??= validated.blurb_en;
      bestResult = {
        ...validated,
        description_zh: acceptedDescriptionZh,
        description_en: acceptedDescriptionEn,
        description: acceptedDescriptionZh,
        blurb_zh: acceptedBlurbZh,
        blurb_en: acceptedBlurbEn,
        validationRejections: allValidationRejections,
        rawResponse: {
          response: data,
          validationRejections: allValidationRejections,
        },
      };

      if (
        acceptedDescriptionZh &&
        acceptedDescriptionEn &&
        acceptedBlurbZh &&
        acceptedBlurbEn
      ) {
        return { result: bestResult, attempts, calls };
      }
    }

    const finalResult = bestResult ?? { ...EMPTY_DESCRIPTION_RESULT };
    return { result: finalResult, attempts, calls };
  } catch (err) {
    // Not a provider signal: every transport error is already converted to an
    // `ok: false` result inside the client, so anything thrown here is local
    // (a missing key, a bug in the parsers). Returning null keeps the phase's
    // pre-Gate-C behaviour rather than attributing a local defect to OpenAI.
    console.error(
      `  → description rewrite failed: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}
