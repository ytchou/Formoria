import { auditedCall } from "@/lib/audit";
import { loadPersistedScrapeText } from "./descriptions";
import {
  buildProfiledEnrichmentConfig,
  createProfiledOpenAIClient,
  profileChatParams,
} from "../llm-audit";
import { STOCKIST_SYSTEM_PROMPT } from "@/lib/prompts/stockists";
import { fetchLangfusePrompt } from "@/lib/langfuse/prompt";
import { parseJson } from "../openai-client";
import type { PhaseResult } from "@/lib/types/curation";
import type { StockistCandidate } from "@/lib/types/stockist";
import {
  brandTarget,
  type EnrichmentTarget,
} from "../_shared/enrichment-target";
import {
  buildPhaseResult,
  timePhase,
  type EnrichBrand,
  type EnrichPhase,
} from "./types";
import {
  upsertEnrichedStockists,
  MAX_ACTIVE_STOCKISTS_PER_BRAND,
} from "../stockists";
import { normalizeStockistName } from "@/lib/brands/stockist-display";
import { CITY_NAMES_ZH, CITY_SLUGS } from "@/lib/constants/taiwan-cities";
import { matchDistrict } from "@/lib/brands/district";
import { createServiceClient } from "@/lib/supabase/service";

const SIGNAL_WORDS = [
  // Location types (zh)
  "門市", "實體店", "店面", "分店", "直營店", "專櫃", "櫃點", "據點",
  "體驗店", "展售", "展示間",
  // Location types (en)
  "store", "shop", "stockist", "retailer", "outlet", "showroom", "studio",
  "boutique", "counter",
  // Activities
  "試穿", "試用", "預約", "參觀", "appointment", "try-on", "fitting", "visit",
  // Distribution
  "寄售", "經銷", "通路", "代理", "零售", "販售", "銷售",
  // Discovery
  "哪裡買", "where to buy", "find us", "store locator", "購買通路",
  // Address signals
  "地址", "address", "located at",
  // Hours
  "營業時間", "opening hours",
];

type LlmStockistEntry = {
  name: string;
  regionSlug: string;
  address?: string | null;
  locationType?: string | null;
  sourceUrl?: string | null;
};

type StockistsModelResult = {
  stockists: LlmStockistEntry[];
};

type StockistsPhaseOptions = {
  brand: EnrichBrand;
  phases: EnrichPhase[];
  scrapedData?: unknown;
  overwrite?: boolean;
  dryRun?: boolean;
  target?: EnrichmentTarget;
  jobId?: string;
};

type StockistsPhaseOutput = {
  phaseResult: PhaseResult;
  patch: Record<string, unknown>;
};

/**
 * Filters siteContent to paragraphs containing stockist signal words.
 * Sections tagged as `stockistPageText` (prefixed with "Stockist Page:") pass
 * unfiltered. Returns null when no signal paragraphs are found.
 */
export function filterStockistEvidence(siteContent: string): string | null {
  const paragraphs = siteContent.split(/\n/);
  const kept: string[] = [];

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // stockistPageText sections pass unfiltered
    if (trimmed.startsWith("Stockist Page:") || trimmed.startsWith("stockistPageText:")) {
      kept.push(trimmed);
      continue;
    }

    const lower = trimmed.toLowerCase();
    if (SIGNAL_WORDS.some((word) => lower.includes(word.toLowerCase()))) {
      kept.push(trimmed);
    }
  }

  return kept.length > 0 ? kept.join("\n") : null;
}

const VALID_CITY_SLUGS = new Set<string>(CITY_SLUGS);

/**
 * Pure validation of LLM-returned stockist entries. Exported for testing.
 */
export function validateStockistCandidates(
  entries: LlmStockistEntry[],
): StockistCandidate[] {
  const validated: StockistCandidate[] = [];

  for (const entry of entries) {
    if (validated.length >= MAX_ACTIVE_STOCKISTS_PER_BRAND) break;

    const name = entry.name?.trim();
    if (!name || name.length > 80) continue;
    if (!VALID_CITY_SLUGS.has(entry.regionSlug)) continue;

    const regionLabel = CITY_NAMES_ZH[entry.regionSlug] ?? null;
    const normalizedName = normalizeStockistName(name);
    const address = entry.address?.trim() || null;
    const district = address ? matchDistrict(address, entry.regionSlug as Parameters<typeof matchDistrict>[1]) : null;

    validated.push({
      name,
      normalizedName,
      regionLabel,
      address,
      url: null,
      sourceUrl: entry.sourceUrl?.trim() || null,
      locationType: isValidLocationType(entry.locationType) ? entry.locationType : null,
      country: "TW",
      district,
      source: "enriched",
    });
  }

  return validated;
}

const VALID_LOCATION_TYPES = new Set([
  "stockist", "distributor_retailer", "direct_store",
  "department_store_counter", "showroom_studio", "shop_in_shop",
  "other_physical_retail",
]);

function isValidLocationType(value: unknown): value is StockistCandidate["locationType"] {
  return typeof value === "string" && VALID_LOCATION_TYPES.has(value);
}

async function hasEnrichedStockists(brandId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { count } = await supabase
    .from("brand_channels")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .eq("source", "enriched")
    .not("name", "is", null)
    .is("removed_at", null);
  return (count ?? 0) > 0;
}

export async function runStockistsPhase({
  brand,
  phases,
  overwrite = false,
  dryRun = false,
  target,
  jobId,
}: StockistsPhaseOptions): Promise<StockistsPhaseOutput> {
  if (!phases.includes("stockists")) {
    return {
      phaseResult: buildPhaseResult(
        "stockists",
        "skipped",
        [],
        0,
        undefined,
        "stockists phase not requested",
      ),
      patch: {},
    };
  }

  if (target?.type === "submission") {
    return {
      phaseResult: buildPhaseResult(
        "stockists",
        "skipped",
        [],
        0,
        undefined,
        "stockists phase does not run for submission targets",
      ),
      patch: {},
    };
  }

  if (!overwrite && (await hasEnrichedStockists(brand.id))) {
    return {
      phaseResult: buildPhaseResult(
        "stockists",
        "skipped",
        [],
        0,
        undefined,
        "enriched stockists already exist",
      ),
      patch: {},
    };
  }

  return auditedCall(
    { provider: "enrich", operation: "runStockistsPhase", kind: "service" },
    async (_ctx) => {
      const { result, durationMs } = await timePhase(async () => {
        const auditTarget = target ?? brandTarget(brand.id);
        const persistedScrape = await loadPersistedScrapeText(auditTarget);

        if (!persistedScrape.siteContent) {
          return { candidates: [], skippedReason: "no stockist evidence" };
        }

        const filteredEvidence = filterStockistEvidence(persistedScrape.siteContent);
        if (!filteredEvidence) {
          return { candidates: [], skippedReason: "no stockist signal in evidence" };
        }

        const evidence = filteredEvidence.length > 12_000
          ? filteredEvidence.slice(0, 12_000)
          : filteredEvidence;

        const systemPrompt = await fetchLangfusePrompt("stockists", STOCKIST_SYSTEM_PROMPT);
        const config = buildProfiledEnrichmentConfig(
          "stockists",
          systemPrompt,
          "stockists",
          {},
        );
        const token = process.env.OPENAI_API_KEY;
        const client = createProfiledOpenAIClient(
          "stockists",
          {
            ...(jobId ? { jobId } : {}),
            target: auditTarget,
            phase: "stockists",
            attempt: 1,
            config,
          },
          { apiKey: token },
        );

        const response = await client.chat({
          system: systemPrompt,
          user: evidence,
          json: true,
          ...profileChatParams("stockists"),
        });

        if (!response.response.ok) {
          return {
            candidates: [],
            providerFailed: true,
          };
        }

        const parsed = parseJson<StockistsModelResult>(response.content ?? "");
        const rawEntries = parsed?.stockists ?? [];
        const candidates = validateStockistCandidates(rawEntries);
        const now = new Date().toISOString();
        const timestamped = candidates.map((c) => ({ ...c, fetchedAt: now }));
        return { candidates: timestamped };
      });

      if (result.providerFailed) {
        return {
          phaseResult: {
            ...buildPhaseResult(
              "stockists",
              "failed",
              [],
              durationMs,
              "LLM provider failed the stockists call",
            ),
            providerFailure: true,
          },
          patch: {},
        };
      }

      if (result.skippedReason) {
        return {
          phaseResult: buildPhaseResult(
            "stockists",
            "skipped",
            [],
            durationMs,
            undefined,
            result.skippedReason,
          ),
          patch: {},
        };
      }

      if (result.candidates.length === 0) {
        return {
          phaseResult: buildPhaseResult(
            "stockists",
            "skipped",
            [],
            durationMs,
            undefined,
            "no stockists found in evidence",
          ),
          patch: {},
        };
      }

      if (!dryRun) {
        const upsertResult = await upsertEnrichedStockists(brand.id, result.candidates);
        if (!upsertResult.ok) {
          return {
            phaseResult: buildPhaseResult(
              "stockists",
              "failed",
              [],
              durationMs,
              `stockist upsert failed: ${upsertResult.code}`,
            ),
            patch: {},
          };
        }
      }

      return {
        phaseResult: buildPhaseResult(
          "stockists",
          "succeeded",
          [`${result.candidates.length} stockist(s)`],
          durationMs,
        ),
        patch: {},
      };
    },
    {
      classify: (r) =>
        r.phaseResult.status === "failed" ? "failed" : "succeeded",
    },
  );
}
