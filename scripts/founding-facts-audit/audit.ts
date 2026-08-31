import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { load } from "cheerio";
import { artifactPath } from "../shared/artifact";
import { createServiceClient } from "@/lib/supabase/service";
import { CITY_SLUGS, type CitySlug } from "@/lib/constants/taiwan-cities";
import {
  researchFoundingFacts,
  type FoundingFactSource,
} from "@/lib/services/brand-facts";
import {
  deriveFoundingFactAction,
  evaluateFoundingFact,
  type EvaluatedFoundingFact,
  type FoundingFactField,
  type FoundingFactValue,
} from "@/lib/services/founding-facts";
import { fetchHtmlWithMetadata } from "@/lib/services/enrich-phases/scraper/fetch-guards";
import { batchSearchBrandsWithSnippets } from "@/lib/services/enrich-phases/scraper/serper";
import type { BrandSearchEntry } from "@/lib/services/enrich-phases/scraper/types";
import type {
  FoundingFactsAuditArtifact,
  FoundingFactsBrandAudit,
  FoundingFactsFieldAudit,
  FoundingFactsSourceAttempt,
} from "./core";

type BrandRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  city: string | null;
  founding_year: number | null;
  purchase_website: string | null;
  social_instagram: string | null;
  social_threads: string | null;
  social_facebook: string | null;
  purchase_pinkoi: string | null;
  purchase_shopee: string | null;
  purchase_myship: string | null;
  other_urls: unknown;
  seo_promoted: boolean | null;
};

type FieldStateRow = {
  brand_id: string;
  field: string;
  source: string;
  updated_by: string | null;
};

const BRAND_COLUMNS = [
  "id",
  "name",
  "slug",
  "status",
  "city",
  "founding_year",
  "purchase_website",
  "social_instagram",
  "social_threads",
  "social_facebook",
  "purchase_pinkoi",
  "purchase_shopee",
  "purchase_myship",
  "other_urls",
  "seo_promoted",
].join(", ");

const SEARCH_QUERY = (brandName: string): string =>
  `"${brandName}" (創立 OR 成立 OR founded OR established) (地點 OR 縣市 OR 年)`;
const INDEPENDENT_PAGE_LIMIT = 5;

function hostOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return null;
  }
}

function isFormoriaUrl(rawUrl: string): boolean {
  const host = hostOf(rawUrl);
  if (!host) return true;
  const configuredHost = hostOf(process.env.NEXT_PUBLIC_SITE_URL ?? "");
  return (
    host.includes("formoria") ||
    (configuredHost != null && host === configuredHost)
  );
}

function otherUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (
      typeof item === "object" &&
      item !== null &&
      "url" in item &&
      typeof item.url === "string"
    ) {
      return [item.url];
    }
    return [];
  });
}

function knownLinks(brand: BrandRow): Array<{
  url: string;
  sourceType: "first-party" | "independent";
}> {
  const firstParty = [
    brand.purchase_website,
    brand.social_instagram,
    brand.social_threads,
    brand.social_facebook,
    brand.purchase_pinkoi,
    brand.purchase_shopee,
    brand.purchase_myship,
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  const firstPartyHosts = new Set(
    firstParty.map(hostOf).filter((host): host is string => host != null),
  );
  const combined = [
    ...firstParty.map((url) => ({ url, sourceType: "first-party" as const })),
    ...otherUrls(brand.other_urls).map((url) => ({
      url,
      sourceType: firstPartyHosts.has(hostOf(url) ?? "")
        ? ("first-party" as const)
        : ("independent" as const),
    })),
  ].filter((item) => !isFormoriaUrl(item.url));

  return [
    ...new Map(
      combined.map((item) => [item.url.replace(/#.*$/u, ""), item]),
    ).values(),
  ];
}

function extractedPageText(html: string): string | null {
  const $ = load(html);
  $("script, style, noscript, svg").remove();
  const metadata = [
    $("title").text(),
    $('meta[name="description"]').attr("content") ?? "",
    $('meta[property="og:description"]').attr("content") ?? "",
  ];
  const body = $("body").text();
  const text = [...metadata, body].join("\n").replace(/\s+/gu, " ").trim();
  return text ? text.slice(0, 20_000) : null;
}

async function fetchSource(
  url: string,
  sourceType: "first-party" | "independent",
  discoveredBy: "known-link" | "search",
  reputable: boolean,
): Promise<FoundingFactsSourceAttempt> {
  const result = await fetchHtmlWithMetadata(url);
  const text = result.text ? extractedPageText(result.text) : null;
  return {
    url,
    sourceType,
    reputable,
    discoveredBy,
    fetched: text != null,
    text,
    httpStatus: result.status,
    latencyMs: result.latencyMs,
    error: result.error ?? (result.text && !text ? "empty page text" : null),
  };
}

function selectIndependentPages(
  entries: readonly BrandSearchEntry[],
  knownHosts: ReadonlySet<string>,
): BrandSearchEntry[] {
  const seenHosts = new Set<string>();
  return entries.filter((entry) => {
    const host = hostOf(entry.link);
    if (
      !host ||
      knownHosts.has(host) ||
      seenHosts.has(host) ||
      isFormoriaUrl(entry.link) ||
      seenHosts.size >= INDEPENDENT_PAGE_LIMIT
    ) {
      return false;
    }
    seenHosts.add(host);
    return true;
  });
}

function snippetAttempts(
  entries: readonly BrandSearchEntry[],
  fetchedUrls: ReadonlySet<string>,
): FoundingFactsSourceAttempt[] {
  return entries.flatMap((entry) => {
    if (
      !entry.snippet?.trim() ||
      fetchedUrls.has(entry.link) ||
      isFormoriaUrl(entry.link)
    )
      return [];
    return [
      {
        url: entry.link,
        sourceType: "search-snippet" as const,
        reputable: false,
        discoveredBy: "search" as const,
        fetched: false,
        text: entry.snippet.trim(),
        httpStatus: null,
        latencyMs: 0,
        error: null,
      },
    ];
  });
}

function researchSources(
  attempts: readonly FoundingFactsSourceAttempt[],
): FoundingFactSource[] {
  return attempts.flatMap((attempt) =>
    attempt.text
      ? [
          {
            url: attempt.url,
            text: attempt.text,
            sourceType: attempt.sourceType,
            reputable: attempt.reputable,
            fetched: attempt.fetched,
          },
        ]
      : [],
  );
}

function fieldProtection(
  state: FieldStateRow | undefined,
): "protected:owner" | "protected:admin" | null {
  if (state?.source === "owner") return "protected:owner";
  if (state?.source === "admin" && state.updated_by) return "protected:admin";
  return null;
}

function currentCity(value: string | null): CitySlug | null {
  if (value == null) return null;
  if (CITY_SLUGS.includes(value as CitySlug)) return value as CitySlug;
  throw new Error(`approved brand has unsupported city slug: ${value}`);
}

function fieldAudit(input: {
  field: FoundingFactField;
  current: FoundingFactValue | null;
  proposal: EvaluatedFoundingFact;
  state?: FieldStateRow;
  hasHumanOrigin: boolean;
}): FoundingFactsFieldAudit {
  const protection = fieldProtection(input.state);
  const action = deriveFoundingFactAction(
    input.proposal,
    input.current,
    protection,
  );
  return {
    field: input.field,
    expectedCurrent: input.current,
    protection,
    proposal: input.proposal,
    action,
    requiresDecision: action === "review",
    humanOriginConflict:
      input.hasHumanOrigin &&
      input.proposal.value != null &&
      input.proposal.value !== input.current,
  };
}

function selectPilot(
  brands: readonly BrandRow[],
  states: ReadonlyMap<string, FieldStateRow[]>,
): BrandRow[] {
  const groups = [
    (brand: BrandRow) => brand.city != null && brand.founding_year != null,
    (brand: BrandRow) => brand.city != null && brand.founding_year == null,
    (brand: BrandRow) => brand.city == null && brand.founding_year != null,
    (brand: BrandRow) => brand.city == null && brand.founding_year == null,
  ];
  const provenanceRank = (brand: BrandRow): number => {
    const brandStates = states.get(brand.id) ?? [];
    if (brandStates.some((state) => state.source === "enriched")) return 0;
    if (
      brandStates.some(
        (state) => state.source === "admin" && state.updated_by == null,
      )
    )
      return 1;
    return 2;
  };
  const selected = groups.flatMap((matches) =>
    brands
      .filter(matches)
      .toSorted(
        (left, right) =>
          provenanceRank(left) - provenanceRank(right) ||
          left.slug.localeCompare(right.slug),
      )
      .slice(0, 5),
  );
  const reservedIds = new Set<string>();

  const ensureProvenance = (
    matchesState: (state: FieldStateRow) => boolean,
    label: string,
  ): void => {
    const existing = selected.find((brand) =>
      (states.get(brand.id) ?? []).some(matchesState),
    );
    if (existing) {
      reservedIds.add(existing.id);
      return;
    }
    const replacement = brands.find(
      (brand) =>
        !selected.some((candidate) => candidate.id === brand.id) &&
        (states.get(brand.id) ?? []).some(matchesState),
    );
    if (!replacement)
      throw new Error(`pilot cannot include required ${label} provenance`);
    const groupIndex = groups.findIndex((matches) => matches(replacement));
    if (groupIndex < 0)
      throw new Error(`pilot replacement has no completeness group`);
    const replaceIndex = [4, 3, 2, 1, 0]
      .map((offset) => groupIndex * 5 + offset)
      .find((index) => !reservedIds.has(selected[index]!.id));
    if (replaceIndex == null)
      throw new Error(`pilot ${label} provenance has no replaceable slot`);
    selected[replaceIndex] = replacement;
    reservedIds.add(replacement.id);
  };

  ensureProvenance((state) => state.source === "enriched", "enriched");
  ensureProvenance(
    (state) => state.source === "admin" && state.updated_by == null,
    "unattributed-admin",
  );
  return selected;
}

async function loadFieldStates(
  brandIds: string[],
): Promise<Map<string, FieldStateRow[]>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brand_field_state")
    .select("brand_id, field, source, updated_by")
    .in("brand_id", brandIds)
    .in("field", ["city", "founding_year"]);
  if (error) throw error;
  const byBrand = new Map<string, FieldStateRow[]>();
  for (const state of (data ?? []) as FieldStateRow[]) {
    const rows = byBrand.get(state.brand_id) ?? [];
    rows.push(state);
    byBrand.set(state.brand_id, rows);
  }
  return byBrand;
}

async function loadHumanOriginBrandIds(
  brandIds: string[],
): Promise<Set<string>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brand_faq_entries")
    .select("brand_id")
    .in("brand_id", brandIds)
    .eq("preset_id", "origin-story")
    .eq("source", "human");
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.brand_id));
}

async function auditBrand(
  brand: BrandRow,
  fieldStates: readonly FieldStateRow[],
  hasHumanOrigin: boolean,
): Promise<
  FoundingFactsBrandAudit & { searchFailed: boolean; llmCalls: number }
> {
  const known = knownLinks(brand);
  const knownAttempts = await Promise.all(
    known.map((source) =>
      fetchSource(
        source.url,
        source.sourceType,
        "known-link",
        source.sourceType === "first-party",
      ),
    ),
  );
  const searchMap = await batchSearchBrandsWithSnippets(
    [brand.name],
    SEARCH_QUERY,
    1,
    {
      target: { type: "brand", id: brand.id },
      config: { purpose: "founding-facts-audit", resultLimit: 10 },
    },
  );
  const search = searchMap.get(brand.name);
  const entries = search?.entries ?? [];
  const knownHosts = new Set(
    known
      .map((source) => hostOf(source.url))
      .filter((host): host is string => host != null),
  );
  const independentEntries = selectIndependentPages(entries, knownHosts);
  const independentAttempts = await Promise.all(
    independentEntries.map((entry) =>
      fetchSource(
        entry.link,
        "independent",
        "search",
        (entry.position ?? Number.MAX_SAFE_INTEGER) <= 5,
      ),
    ),
  );
  const fetchedUrls = new Set(
    independentAttempts
      .filter((attempt) => attempt.fetched)
      .map((attempt) => attempt.url),
  );
  const sources = [
    ...knownAttempts,
    ...independentAttempts,
    ...snippetAttempts(entries, fetchedUrls),
  ];
  const research = await researchFoundingFacts(
    brand.name,
    researchSources(sources),
    { target: { type: "brand", id: brand.id } },
  );
  const emptyResearch = {
    city: evaluateFoundingFact("city", []),
    foundingYear: evaluateFoundingFact("founding_year", []),
    calls: { attempted: 0, providerFailed: 0 },
  };
  const evaluated = research ?? emptyResearch;
  const stateByField = new Map(
    fieldStates.map((state) => [state.field, state]),
  );

  return {
    snapshot: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      status: brand.status,
      city: currentCity(brand.city),
      foundingYear: brand.founding_year,
      seoPromoted: brand.seo_promoted === true,
    },
    sources,
    fields: {
      city: fieldAudit({
        field: "city",
        current: currentCity(brand.city),
        proposal: evaluated.city,
        state: stateByField.get("city"),
        hasHumanOrigin,
      }),
      founding_year: fieldAudit({
        field: "founding_year",
        current: brand.founding_year,
        proposal: evaluated.foundingYear,
        state: stateByField.get("founding_year"),
        hasHumanOrigin,
      }),
    },
    searchFailed: ["failed", "timeout", "network_error"].includes(
      search?.callStatus ?? "",
    ),
    llmCalls: evaluated.calls.attempted,
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await fn(values[index]!, index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      worker(),
    ),
  );
  return output;
}

async function loadLlmSpend(
  brandIds: string[],
  startedAt: string,
): Promise<{ costUsd: number | null; unpriced: number }> {
  const { data, error } = await createServiceClient()
    .from("brand_ai_results")
    .select("cost_usd")
    .in("brand_id", brandIds)
    .in("phase", ["founding_facts", "founding_facts_verify"])
    .gte("created_at", startedAt);
  if (error) throw error;
  const rows = data ?? [];
  const priced = rows.flatMap((row) =>
    typeof row.cost_usd === "number" ? [row.cost_usd] : [],
  );
  return {
    costUsd:
      priced.length > 0 ? priced.reduce((sum, value) => sum + value, 0) : null,
    unpriced: rows.length - priced.length,
  };
}

export async function runAudit(options: {
  mode: "pilot" | "all";
  concurrency?: number;
}): Promise<string> {
  const startedAt = new Date().toISOString();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brands")
    .select(BRAND_COLUMNS)
    .eq("status", "approved")
    .order("slug");
  if (error) throw error;
  const approved = (data ?? []) as unknown as BrandRow[];
  const allStates = await loadFieldStates(approved.map((brand) => brand.id));
  const selected =
    options.mode === "pilot" ? selectPilot(approved, allStates) : approved;
  if (options.mode === "pilot" && selected.length !== 20) {
    throw new Error(
      `pilot requires five brands in each completeness group; selected ${selected.length}`,
    );
  }
  const humanOriginIds = await loadHumanOriginBrandIds(
    selected.map((brand) => brand.id),
  );
  const results = await mapWithConcurrency(
    selected,
    Math.max(1, Math.min(options.concurrency ?? 3, 5)),
    async (brand, index) => {
      console.log(`[${index + 1}/${selected.length}] auditing ${brand.slug}`);
      return auditBrand(
        brand,
        allStates.get(brand.id) ?? [],
        humanOriginIds.has(brand.id),
      );
    },
  );
  const spend = await loadLlmSpend(
    selected.map((brand) => brand.id),
    startedAt,
  );
  const artifact: FoundingFactsAuditArtifact = {
    version: 1,
    runId: randomUUID(),
    createdAt: new Date().toISOString(),
    mode: options.mode,
    metrics: {
      approvedCount: selected.length,
      cityPopulatedBefore: selected.filter((brand) => brand.city != null)
        .length,
      foundingYearPopulatedBefore: selected.filter(
        (brand) => brand.founding_year != null,
      ).length,
      seoPromotedBefore: selected.filter((brand) => brand.seo_promoted === true)
        .length,
      searchFailures: results.filter((result) => result.searchFailed).length,
      fetchFailures: results.reduce(
        (sum, result) =>
          sum + result.sources.filter((source) => source.error != null).length,
        0,
      ),
      serperCredits: selected.length,
      llmCalls: results.reduce((sum, result) => sum + result.llmCalls, 0),
      llmCostUsd: spend.costUsd,
      llmUnpricedCalls: spend.unpriced,
    },
    brands: results.map(
      ({ searchFailed: _searchFailed, llmCalls: _llmCalls, ...brand }) => brand,
    ),
  };
  const output = artifactPath("founding-facts", {
    prefix: "audit",
    ext: "json",
    suffix: process.pid,
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return output;
}
