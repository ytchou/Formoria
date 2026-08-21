import { insertReputationResult } from "../_shared/ai-results";
import { auditedCall } from "@/lib/audit";
import { reportBannedTerms } from "@/lib/i18n/banned-terms";
import { runReputationResearch } from "../reputation-research";
import { loadPersistedScrapeText } from "./descriptions";
import { buildProfiledEnrichmentConfig } from "../llm-audit";
import { REPUTATION_SYSTEM_PROMPT } from "@/lib/prompts";
import { localizeToTW } from "../taiwan-localization";
import { isLlmProviderFailure, noLlmCalls } from "../_shared/llm-call-outcome";
import type { PhaseResult } from "@/lib/types/curation";
import type { EnrichScrapedData } from "./types";
import {
  brandTarget,
  type EnrichmentTarget,
} from "../_shared/enrichment-target";
import {
  buildPhaseResult,
  hasPatchValues,
  timePhase,
  type EnrichBrand,
  type EnrichPhase,
} from "./types";

/** Prompt-shaping params — stored in the audit contract, not sent as request params. */
const REPUTATION_PROMPT_PARAMS = {
  snippetLimit: 10,
  siteContentLimit: 4000,
};

type ReputationPhaseOptions = {
  brand: EnrichBrand;
  phases: EnrichPhase[];
  scrapedData: EnrichScrapedData | null;
  serpSnippets: string[];
  overwrite?: boolean;
  target?: EnrichmentTarget;
  jobId?: string;
};

type ReputationPhaseOutput = {
  phaseResult: PhaseResult;
  patch: Record<string, unknown>;
};

function hasReputationValues(brand: EnrichBrand): boolean {
  return brand.reputation_summary != null;
}

/** Empty for the purposes of "is there anything here worth clearing?". */
function isEmptyFieldValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object")
    return Object.keys(value as object).length === 0;
  return false;
}

/**
 * Fields this run affirmatively determined should be EMPTY.
 *
 * A refresh can add and change a field but has no way to empty one: an omitted
 * key means "no opinion" all the way down to the apply RPC, so a value the
 * model has since judged unqualified survives every future run. This is the
 * explicit verdict that makes a clear possible — see `_cleared_fields` in
 * `apply_brand_refresh_with_protected_location_gate`.
 *
 * The policy is deliberately one field. `reputation_summary`'s prompt contract
 * makes null an affirmative verdict: it returns null when there is no
 * third-party evaluation. A null `city`, `founding_year`, `category` or
 * link means "could not determine this run", and clearing those would destroy
 * correct data whenever a SERP call came back thin.
 *
 * Returns nothing when `research` is null: a phase that did not run, or whose
 * LLM call failed, is silence, not a verdict.
 */
export function resolveClearedFields(
  research: { reputationSummary: unknown } | null,
  brand: EnrichBrand,
  shouldWrite: (existing: unknown) => boolean,
): string[] {
  if (!research) return [];

  const cleared: string[] = [];
  if (
    !research.reputationSummary &&
    shouldWrite(brand.reputation_summary) &&
    !isEmptyFieldValue(brand.reputation_summary)
  ) {
    cleared.push("reputation_summary");
  }

  return cleared;
}

function truncateSiteContent(siteContent: unknown): string | null {
  if (siteContent == null) return null;
  const content =
    typeof siteContent === "string"
      ? siteContent
      : typeof siteContent === "object"
        ? JSON.stringify(siteContent)
        : String(siteContent);

  return content.length > 4000 ? content.slice(0, 4000) : content;
}

function getBrandSiteContent(brand: EnrichBrand): string | null {
  return truncateSiteContent(brand.site_content);
}

function getCategory(brand: EnrichBrand): string | null {
  return brand.category ?? null;
}

/**
 * Sole owner of `reputation_summary` since the descriptions mega-call was split.
 *
 * The copy call used to ask for the same field under looser rules and won
 * whenever it produced anything, because this phase short-circuited on a
 * `reputationAlreadySet` flag. That flag is gone: the strict prompt here is the
 * only contract the field has.
 */
export async function runReputationPhase({
  brand,
  phases,
  serpSnippets,
  overwrite = false,
  target,
  jobId,
}: ReputationPhaseOptions): Promise<ReputationPhaseOutput> {
  if (!phases.includes("reputation")) {
    return {
      phaseResult: buildPhaseResult(
        "reputation",
        "skipped",
        [],
        0,
        undefined,
        "reputation phase not requested",
      ),
      patch: {},
    };
  }

  if (!overwrite && hasReputationValues(brand)) {
    return {
      phaseResult: buildPhaseResult(
        "reputation",
        "skipped",
        [],
        0,
        undefined,
        "reputation fields already populated",
      ),
      patch: {},
    };
  }

  return auditedCall(
    { provider: "enrich", operation: "runReputationPhase", kind: "service" },
    async (ctx) => {
      const { result, durationMs } = await timePhase(async () => {
        const auditTarget = target ?? brandTarget(brand.id);
        const persistedScrape = await loadPersistedScrapeText(auditTarget);
        const brandSiteContent = getBrandSiteContent(brand);
        const siteContent =
          [brandSiteContent, persistedScrape.siteContent]
            .filter(Boolean)
            .join("\n\n") || null;
        const reputationInput = {
          name: brand.name ?? "",
          description: brand.description ?? null,
          category: getCategory(brand),
          serpSnippets: [...serpSnippets, ...persistedScrape.snippets],
          siteContent,
        };
        const reputationOutcome = await runReputationResearch(reputationInput, {
          target: auditTarget,
          phase: "reputation",
          ...(jobId ? { jobId } : {}),
          config: buildProfiledEnrichmentConfig(
            "reputation",
            REPUTATION_SYSTEM_PROMPT,
            "reputation",
            REPUTATION_PROMPT_PARAMS,
          ),
        });

        const calls = reputationOutcome?.calls ?? noLlmCalls();
        const reputationResearch = reputationOutcome?.result ?? null;

        if (!reputationResearch) {
          return { patch: {}, calls };
        }

        // Same policy the descriptions phase used when it owned this field. In
        // practice only an `overwrite` run reaches it: a brand that already has a
        // reputation and is not being overwritten was skipped above.
        const shouldWrite = (existing: unknown) =>
          overwrite ||
          existing == null ||
          (typeof existing === "string" && existing.trim() === "") ||
          (Array.isArray(existing) && existing.length === 0);

        const summary = reputationResearch.reputationSummary;
        const localizedSummary =
          summary != null
            ? { ...summary, text: localizeToTW(summary.text).text }
            : null;
        // Report-only (DEV-1546), on the text this patch actually carries: the
        // summary is stored exactly as the model wrote it, and any mainland-Chinese
        // term in it is recorded on this span rather than rewritten. Substring
        // rewriting cannot tell a banned term from a correct word that contains it.
        reportBannedTerms(ctx, [
          ["reputation_summary", localizedSummary?.text],
        ]);

        const patch: Record<string, unknown> = {
          ...(localizedSummary != null
            ? { reputation_summary: localizedSummary }
            : {}),
        };

        // The complement of the conditional spread above: it contributes `{}` when
        // it has nothing to say, which the apply RPC reads as "leave the current
        // value alone". `_cleared_fields` is how this phase says "I looked, and
        // this field should now be empty".
        const clearedFields = resolveClearedFields(
          reputationResearch,
          brand,
          shouldWrite,
        );
        if (clearedFields.length > 0) {
          patch._cleared_fields = clearedFields;
        }

        return { patch, calls };
      });

      // The single reputation call failed at the provider. Reporting `succeeded`
      // with an empty patch is indistinguishable from "this brand has no
      // reputation coverage", and that ambiguity is what let a spent OpenAI
      // account produce green targets on 2026-08-02.
      if (isLlmProviderFailure(result.calls)) {
        return {
          phaseResult: {
            ...buildPhaseResult(
              "reputation",
              "failed",
              [],
              durationMs,
              "LLM provider failed the reputation call",
            ),
            providerFailure: true,
          },
          patch: {},
        };
      }

      if (hasPatchValues(result.patch)) {
        await insertReputationResult({
          brandId: brand.id,
          target: target ?? brandTarget(brand.id),
        });
      }

      return {
        phaseResult: buildPhaseResult(
          "reputation",
          "succeeded",
          hasPatchValues(result.patch)
            ? [
                ...["reputation_summary"].filter(
                  (field) => field in result.patch,
                ),
                ...(Array.isArray(result.patch._cleared_fields)
                  ? (result.patch._cleared_fields as string[])
                  : []),
              ]
            : [],
          durationMs,
        ),
        patch: result.patch,
      };
    },
    {
      classify: (result) =>
        result.phaseResult.status === "failed" ? "failed" : "succeeded",
    },
  );
}
