/**
 * Runs the production curation pipeline end to end for a brand set, under one
 * named model, and writes nothing to Postgres or Storage.
 *
 *   OPENAI_MODEL_OVERRIDE=gpt-4o-mini \
 *   CURATION_EVAL_SINK=$PWD/scripts/model-ab/runs/mini.jsonl \
 *   pnpm exec tsx --env-file=.env.local scripts/model-ab/run.ts \
 *     --slugs entadar,heyyou-moment,yates --out scripts/model-ab/runs/mini.json
 *
 * Both env vars are read at module load by code under `src/`, so they must be
 * set on the command line — setting them from inside this file is too late.
 *
 * Two halves, because the pipeline cannot run both under one entry point:
 *
 *   TEXT   `runEnrich` with `dryRun: true`, through a write-blocking client.
 *          Produces the field patch (name, category, tags, descriptions,
 *          channels) via the real phase chain.
 *
 *   IMAGE  `dryRun` *skips* classification outright (classify-images.ts:809),
 *          so the image half re-runs the production modules directly —
 *          query building, serper, candidate pool, the real download gates in
 *          memory, the real classifier prompt and parser, the real ranker.
 *          Adapted from scripts/image-eval/pipeline-ab.ts, which established
 *          this technique; the divergence is that the model is a parameter and
 *          token usage is recorded.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import sharp from "sharp";
import { buildImageQueryVariants } from "@/lib/services/enrich-phases/scraper/search";
import {
  scrapeBrandUrls,
  MAX_SCRAPE_URLS_PER_BRAND,
} from "@/lib/services/enrich-phases/scraper";
import {
  classifyByDomain,
  isNonBrandSiteHost,
} from "@/lib/services/enrich-phases/scraper/input-detector";
import {
  buildCandidatePool,
  type CandidateImage,
} from "@/lib/services/enrich-phases/candidate-pool";
import {
  buildBrandContext,
  parseClassificationBatch,
  applyClassifications,
  IMAGE_CLASSIFICATION_SCHEMA,
} from "@/lib/services/enrich-phases/classify-images";
import { IMAGE_CLASSIFY_SYSTEM_PROMPT } from "@/lib/prompts";
import {
  computeDHash,
  isNonImageContentType,
} from "@/lib/services/image-download";
import { cleanBrandName } from "@/lib/services/brand-cleanup";
import {
  createOpenAIClient,
  resolveOpenAIModel,
} from "@/lib/services/openai-client";
import { runEnrich } from "@/lib/services/curation-operations";
import type { CurationPatchEvent, PhaseResult } from "@/lib/types/curation";
import { setAuditWriteSeam, type AuditRecord } from "@/lib/audit";
import { createWriteBlockingClient } from "./readonly-client";
import { installHttpCache, httpCacheStats } from "./http-cache";

/** Mirrors the production gates in image-download.ts. */
const MIN_SHORT_EDGE = 480;
const MAX_ASPECT = 3.0;
const MIN_ENTROPY = 0.5;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);
const PHASH_HAMMING_THRESHOLD = 5;
/** Mirrors BATCH_SIZE in classify-images.ts. */
const BATCH_SIZE = 5;
/** Mirrors MAX_BRAND_ACTIVE_IMAGES. */
const PUBLISH_CAP = 10;

type GateResult =
  | "kept"
  | "fetch failed"
  | "content-type"
  | "too small"
  | "aspect"
  | "entropy"
  | "format"
  | "duplicate";

type EvalImage = {
  url: string;
  host: string;
  source: string;
  method: string;
  w: number;
  h: number;
  gate: GateResult;
  dataUri?: string;
  disposition?: string;
  tag?: string | null;
  score?: number;
  reasons?: string[];
  altZh?: string;
  rank?: number;
  published?: boolean;
};

type Usage = { prompt: number; completion: number; calls: number };

type EvalBrand = {
  slug: string;
  name: string;
  nameAfter: string;
  productTypeBefore: string | null;
  routingBranch: string;
  imageQuery: string;
  scrapedUrls: string[];
  candidateCount: number;
  bySource: Record<string, number>;
  images: EvalImage[];
  textPatch: Record<string, unknown>;
  textPhases: Array<{
    phase: string;
    status: string;
    changedFields: string[];
    durationMs: number;
    error?: string;
    detail?: string;
  }>;
  imageUsage: Usage;
  textUsage: Usage;
  textUsageByPhase: Record<string, Usage>;
  error?: string;
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv.at(index + 1);
}

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "?";
  }
};

function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** The production download gates, applied to bytes held in memory. Nothing is uploaded. */
async function gateCandidate(
  candidate: CandidateImage,
  claimed: string[],
): Promise<EvalImage> {
  const base = {
    url: candidate.url,
    host: hostOf(candidate.url),
    source: candidate.source,
    method: candidate.method ?? candidate.source,
    w: 0,
    h: 0,
  };
  try {
    const res = await fetch(candidate.url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ...base, gate: "fetch failed" };
    if (isNonImageContentType(res.headers.get("content-type") ?? ""))
      return { ...base, gate: "content-type" };

    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const sized = { ...base, w, h };

    if (!meta.format || !ALLOWED_FORMATS.has(meta.format))
      return { ...sized, gate: "format" };
    if (Math.min(w, h) < MIN_SHORT_EDGE) return { ...sized, gate: "too small" };
    if (Math.max(w, h) / Math.max(1, Math.min(w, h)) > MAX_ASPECT)
      return { ...sized, gate: "aspect" };

    const stats = await sharp(buffer).stats();
    if (typeof stats.entropy === "number" && stats.entropy < MIN_ENTROPY)
      return { ...sized, gate: "entropy" };

    const phash = await computeDHash(buffer);
    if (
      claimed.some((known) => hamming(known, phash) < PHASH_HAMMING_THRESHOLD)
    ) {
      return { ...sized, gate: "duplicate" };
    }
    claimed.push(phash);

    const webp = await sharp(buffer)
      .resize({ width: 512, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return {
      ...sized,
      gate: "kept",
      dataUri: `data:image/webp;base64,${webp.toString("base64")}`,
    };
  } catch {
    return { ...base, gate: "fetch failed" };
  }
}

/**
 * Goes through the production OpenAI client rather than a raw fetch, so the
 * A/B inherits the real 429 backoff and — critically — the real
 * temperature/reasoning negotiation: on a gpt-5 model a temperature implies
 * `reasoning_effort: 'none'`, which is the configuration production runs.
 */
async function classifyBatch(
  brandContext: string,
  images: EvalImage[],
  usage: Usage,
): Promise<
  Map<
    string,
    {
      disposition: string;
      tag: string | null;
      score: number;
      reasons: string[];
      altZh: string;
    }
  >
> {
  const ordinals = images.map((_, i) => String(i + 1));
  const client = createOpenAIClient();
  const result = await client.chat({
    system: IMAGE_CLASSIFY_SYSTEM_PROMPT,
    user: `${brandContext}Classify the ${images.length} brand images that follow, numbered ${ordinals.join(", ")} in order. Return a JSON object with a "classifications" array holding exactly ${images.length} objects, whose "id" values are the image numbers as strings. Do not omit any image.`,
    json: true,
    // Production constrains this call with a strict JSON schema; an earlier
    // version of this harness sent only `json: true`, which let both models
    // answer in a looser shape than they do in production.
    schema: IMAGE_CLASSIFICATION_SCHEMA,
    temperature: 0.1,
    maxTokens: 250 * images.length,
    images: images.map((i) => i.dataUri as string),
    imageDetail: "low",
    timeoutMs: 120_000,
  });

  usage.calls += 1;
  usage.prompt += result.data?.usage?.prompt_tokens ?? 0;
  usage.completion += result.data?.usage?.completion_tokens ?? 0;

  if (!result.ok || !result.content) {
    console.log(
      `      classify failed: status ${result.status} ${JSON.stringify(result.errorBody).slice(0, 160)}`,
    );
    return new Map();
  }

  const out = new Map<
    string,
    {
      disposition: string;
      tag: string | null;
      score: number;
      reasons: string[];
      altZh: string;
    }
  >();
  for (const [ord, v] of parseClassificationBatch(result.content)) {
    out.set(ord, {
      disposition: v.disposition,
      tag: v.tag,
      score: v.score,
      reasons: v.reasons,
      altZh: v.altZh,
    });
  }
  return out;
}

async function serperImages(query: string): Promise<CandidateImage[]> {
  const res = await fetch("https://google.serper.dev/images", {
    method: "POST",
    headers: {
      "X-API-KEY": process.env.SERPER_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      num: 10,
      gl: "tw",
      hl: "zh-TW",
      tbs: "isz:lt,islt:vga",
      autocorrect: false,
    }),
  });
  if (!res.ok) return [];
  const imgs = (((await res.json()) as { images?: unknown[] }).images ??
    []) as Array<{
    imageUrl: string;
    imageWidth?: number;
    imageHeight?: number;
    title?: string;
    link?: string;
  }>;
  return imgs.map((i) => ({
    url: i.imageUrl,
    source: "google_image" as const,
    sourceUrl: i.imageUrl,
    ...(i.link ? { pageUrl: i.link } : {}),
    ...(i.title ? { title: i.title } : {}),
    query,
    ...(i.imageWidth ? { imageWidth: i.imageWidth } : {}),
    ...(i.imageHeight ? { imageHeight: i.imageHeight } : {}),
  }));
}

/** Mirrors prioritizeScrapeUrls in links.ts: round-robin by kind. */
function prioritize(urls: string[]): string[] {
  const official: string[] = [];
  const social: string[] = [];
  const marketplace: string[] = [];
  for (const url of urls) {
    const c = classifyByDomain(url);
    if (c === null) official.push(url);
    else if (c === "social") social.push(url);
    else marketplace.push(url);
  }
  const buckets = [official, social, marketplace];
  const deepest = Math.max(...buckets.map((b) => b.length), 0);
  const ordered: string[] = [];
  for (let i = 0; i < deepest; i++)
    for (const b of buckets) {
      const u = b.at(i);
      if (u) ordered.push(u);
    }
  return ordered;
}

async function main(): Promise<void> {
  const slugs = (argValue("--slugs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const outPath = argValue("--out");
  if (slugs.length === 0 || !outPath)
    throw new Error("usage: --slugs a,b,c --out path.json");
  if (!process.env.CURATION_EVAL_SINK) {
    throw new Error(
      "CURATION_EVAL_SINK must be set, or LLM audit rows will be written to production",
    );
  }

  const model = resolveOpenAIModel();
  const cacheDir = argValue("--cache");
  const cacheMode = (argValue("--cache-mode") ?? "off") as
    "record" | "replay" | "off";
  if (cacheDir && cacheMode !== "off") {
    // Supabase is exempt: its rows are read-only here and already stable.
    installHttpCache(cacheDir, cacheMode, [
      new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host,
    ]);
  }

  console.log(`model:  ${model}`);
  console.log(`brands: ${slugs.join(", ")}`);
  console.log(`sink:   ${process.env.CURATION_EVAL_SINK}`);
  console.log(
    `cache:  ${cacheDir ? `${cacheMode} @ ${cacheDir}` : "off — inputs will NOT be frozen"}\n`,
  );

  const readShims = new Map<string, unknown[]>();
  const { client: supabase, blocked } = createWriteBlockingClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    readShims,
  );

  // The audit envelope's DB sink builds its OWN service client rather than
  // accepting the one threaded through the pipeline, so the write-blocking
  // wrapper above cannot see it. Measured 2026-08-04: a "zero prod writes" run
  // wrote 4 real rows to external_call_audit. Installing the seam closes that
  // hole structurally, the same way createWriteBlockingClient does for tables.
  const auditRecords: AuditRecord[] = [];
  setAuditWriteSeam(async (record) => {
    blocked.push({ table: "external_call_audit", method: "insert" });
    auditRecords.push(record);
    return null;
  });

  const { data: brandRows, error } = await supabase
    .from("brands")
    .select(
      "id, slug, name, product_type, description, purchase_website, social_instagram, social_threads, social_facebook, purchase_pinkoi, purchase_shopee",
    )
    .in("slug", slugs);
  if (error) throw error;
  const rows = (brandRows ?? []) as Array<Record<string, string | null>>;
  if (rows.length !== slugs.length) {
    const found = new Set(rows.map((r) => String(r.slug)));
    throw new Error(
      `missing brand(s): ${slugs.filter((s) => !found.has(s)).join(", ")}`,
    );
  }

  // ---------------- TEXT HALF: the real phase chain, dry ----------------
  //
  // The submission rows below are fabricated in memory and handed to runEnrich
  // through the read shim. They mirror what `request_brand_refresh` would have
  // written for these brands — same columns, same defaults — so the pipeline
  // cannot tell them from a real refresh submission. Their ids are random and
  // exist in no table, which is why every audit lookup keyed on them comes back
  // empty rather than replaying an earlier run's cache.
  const syntheticSubmissions = rows.map((b) => ({
    id: randomUUID(),
    brand_id: null,
    brand_name: b.name,
    submitter_email: "model-ab@formoria.com",
    submitter_name: null,
    description: b.description,
    website_url: b.purchase_website,
    suggested_tags: [],
    status: "pending",
    reviewer_notes: null,
    submitted_at: new Date().toISOString(),
    reviewed_at: null,
    reviewed_by: null,
    validation_status: null,
    validation_errors: null,
    notified_at: null,
    is_brand_owner: false,
    pdpa_consent_at: null,
    source_attribution: null,
    product_type_note: null,
    social_instagram: b.social_instagram,
    social_threads: b.social_threads,
    social_facebook: b.social_facebook,
    purchase_website: b.purchase_website,
    purchase_pinkoi: b.purchase_pinkoi,
    purchase_shopee: b.purchase_shopee,
    other_urls: [],
    enriched_data: null,
    denial_reason: null,
    hero_image_url: null,
    intent: "recommend",
    owner_data: null,
    romanized_name: null,
    base_brand_data: null,
    base_brand_updated_at: null,
    review_overrides: {},
    refresh_requested_by: null,
  }));
  readShims.set("brand_submissions", syntheticSubmissions);
  const slugById = new Map<string, string>(
    syntheticSubmissions.map((s, i) => [
      String(s.id),
      String(rows[i]?.slug ?? ""),
    ]),
  );

  const patches = new Map<string, Record<string, unknown>>();
  const phaseLog = new Map<string, EvalBrand["textPhases"]>();

  console.log("=== text half: runEnrich (dryRun) — steps context, detail\n");
  const textResult = await runEnrich(
    {
      dryRun: true,
      target: "submissions",
      submissionIds: syntheticSubmissions.map((s) => s.id),
      overwrite: true,
      phases: [],
      steps: ["context", "detail"],
      onProgress: (line: string) => console.log(`   ${line}`),
      onPatch: (event: CurationPatchEvent) => {
        // Keyed by the id we minted, not by the slug the pipeline derived —
        // `slugs` is one of the fields under test, so it is not a stable key.
        const slug = slugById.get(event.targetId) ?? event.slug;
        patches.set(slug, event.patch);
        phaseLog.set(
          slug,
          event.phaseResults.map((p: PhaseResult) => ({
            phase: p.phase,
            status: p.status,
            changedFields: p.changedFields,
            durationMs: p.durationMs,
            ...(p.error ? { error: p.error } : {}),
            ...(p.detail ? { detail: p.detail } : {}),
          })),
        );
      },
    } as never,
    supabase as never,
  );
  console.log(
    `\n   text done — processed ${textResult.processed}, updated ${textResult.updated}, skipped ${textResult.skipped}, errors ${textResult.errors.length}`,
  );
  for (const e of textResult.errors) console.log(`   ! ${e}`);

  // ---------------- IMAGE HALF: production modules, in memory ----------------
  const results: EvalBrand[] = [];

  for (const b of rows) {
    const slug = String(b.slug);
    console.log(`\n=== image half: ${b.name} (${slug})`);
    const imageUsage: Usage = { prompt: 0, completion: 0, calls: 0 };

    const nameAfter =
      cleanBrandName(String(b.name ?? slug)).cleanedName.trim() ||
      String(b.name ?? slug);
    const knownUrls = [
      b.purchase_website,
      b.social_instagram,
      b.social_threads,
      b.social_facebook,
      b.purchase_pinkoi,
      b.purchase_shopee,
    ].filter((u): u is string => typeof u === "string" && u.trim().length > 0);

    const scrapeSet = prioritize(knownUrls).slice(0, MAX_SCRAPE_URLS_PER_BRAND);
    let scraped: Record<string, unknown> = {};
    try {
      if (scrapeSet.length > 0)
        scraped = (await scrapeBrandUrls(scrapeSet)).data as unknown as Record<
          string,
          unknown
        >;
    } catch (e) {
      console.log(`   scrape failed: ${String(e).slice(0, 80)}`);
    }

    const rawWebsite =
      (scraped.purchaseWebsite as string) ?? b.purchase_website ?? null;
    const websiteAfter =
      rawWebsite && !isNonBrandSiteHost(rawWebsite) ? rawWebsite : null;

    const queries = buildImageQueryVariants({
      brandName: nameAfter,
      productType: b.product_type,
      purchaseWebsite: websiteAfter,
    });
    const imageQuery = queries.at(0) ?? "";
    const routingBranch = websiteAfter
      ? b.social_instagram
        ? "Website + Instagram"
        : "Website only"
      : b.social_instagram
        ? "Instagram only"
        : "Neither";
    console.log(`   branch: ${routingBranch}\n   query:  ${imageQuery}`);

    const googleImages = imageQuery ? await serperImages(imageQuery) : [];
    const pool = buildCandidatePool({
      scraped: (
        (scraped.imageSources as Array<{
          url: string;
          method: string;
          pageUrl: string;
          position: number;
        }>) ?? []
      ).map((s) => ({
        url: s.url,
        method: s.method,
        pageUrl: s.pageUrl,
        position: s.position,
      })),
      jsonLdImages: (scraped.jsonLdImageUrls as string[]) ?? [],
      googleImages,
    });
    const bySource: Record<string, number> = {};
    for (const c of pool) bySource[c.source] = (bySource[c.source] ?? 0) + 1;
    console.log(`   candidates: ${pool.length}`);

    const claimed: string[] = [];
    const gated: EvalImage[] = [];
    for (const c of pool) gated.push(await gateCandidate(c, claimed));
    const kept = gated.filter((g) => g.gate === "kept");
    console.log(`   passed gates: ${kept.length}/${gated.length}`);

    for (let i = 0; i < kept.length; i += BATCH_SIZE) {
      const chunk = kept.slice(i, i + BATCH_SIZE);
      const verdicts = await classifyBatch(
        buildBrandContext({
          name: nameAfter,
          productType: b.product_type,
          website: websiteAfter,
          // Must mirror runClassifyImagesPhase exactly: the prompt withholds
          // the wrong_brand verdict when no identifier is present, so omitting
          // these would make the harness measure a weaker prompt than prod.
          pinkoi: b.purchase_pinkoi ?? null,
          instagram: b.social_instagram ?? null,
        }),
        chunk,
        imageUsage,
      );
      for (const [ord, v] of verdicts) {
        const image = chunk.at(Number(ord) - 1);
        if (!image) continue;
        image.disposition = v.disposition;
        image.tag = v.tag;
        image.score = v.score;
        image.reasons = v.reasons;
        image.altZh = v.altZh;
      }
    }

    const classifiedForRanker = kept
      .filter((k) => k.disposition)
      .map((k, index) => ({
        id: String(index),
        tag: (k.tag ?? "product") as "product" | "logo",
        score: k.score ?? 0,
        storage_path: null,
        disposition: k.disposition as "keep" | "reject",
        ...(k.reasons?.length ? { rejectionReasons: k.reasons as never } : {}),
        width: k.w,
        height: k.h,
      }));
    const { ordered } = applyClassifications(classifiedForRanker as never);
    ordered.forEach((row, rank) => {
      const image = kept.at(Number(row.id));
      if (!image) return;
      image.rank = rank;
      image.published = rank < PUBLISH_CAP;
    });
    console.log(
      `   keep: ${ordered.length}, published: ${Math.min(ordered.length, PUBLISH_CAP)}, image tokens: ${imageUsage.prompt}+${imageUsage.completion} over ${imageUsage.calls} call(s)`,
    );

    results.push({
      slug,
      name: String(b.name ?? slug),
      nameAfter,
      productTypeBefore: b.product_type,
      routingBranch,
      imageQuery,
      scrapedUrls: scrapeSet,
      candidateCount: pool.length,
      bySource,
      images: gated,
      textPatch: patches.get(slug) ?? {},
      textPhases: phaseLog.get(slug) ?? [],
      imageUsage,
      // Filled after the loop, once the sink can be read back and attributed.
      textUsage: { prompt: 0, completion: 0, calls: 0 },
      textUsageByPhase: {},
    });
  }

  // Text-half usage lives in the sink, keyed by the synthetic submission id.
  // Attribute it back to slugs here rather than in analysis: the ids are minted
  // per run and exist nowhere else, so a later reader has no way to recover the
  // mapping.
  const sinkLines = (await readFile(process.env.CURATION_EVAL_SINK, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean);
  const textBySlug = new Map<
    string,
    { total: Usage; byPhase: Record<string, Usage> }
  >();
  for (const line of sinkLines) {
    const record = JSON.parse(line) as {
      target: { id: string };
      phase: string;
      usage: { prompt_tokens?: number; completion_tokens?: number } | null;
    };
    const slug = slugById.get(record.target.id);
    if (!slug) continue;
    const entry = textBySlug.get(slug) ?? {
      total: { prompt: 0, completion: 0, calls: 0 },
      byPhase: {},
    };
    const phase = (entry.byPhase[record.phase] ??= {
      prompt: 0,
      completion: 0,
      calls: 0,
    });
    const prompt = record.usage?.prompt_tokens ?? 0;
    const completion = record.usage?.completion_tokens ?? 0;
    entry.total.prompt += prompt;
    entry.total.completion += completion;
    entry.total.calls += 1;
    phase.prompt += prompt;
    phase.completion += completion;
    phase.calls += 1;
    textBySlug.set(slug, entry);
  }
  for (const brand of results) {
    const entry = textBySlug.get(brand.slug);
    brand.textUsage = entry?.total ?? { prompt: 0, completion: 0, calls: 0 };
    brand.textUsageByPhase = entry?.byPhase ?? {};
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify(
      {
        model,
        ranAt: new Date().toISOString(),
        blockedWrites: blocked,
        brands: results,
      },
      null,
      2,
    ),
  );
  console.log("\nper-brand tokens (text + image):");
  for (const b of results) {
    console.log(
      `  ${b.slug.padEnd(16)} text ${b.textUsage.prompt}+${b.textUsage.completion}  image ${b.imageUsage.prompt}+${b.imageUsage.completion}`,
    );
  }
  console.log(`\nwrote ${outPath}`);
  console.log(
    blocked.length === 0
      ? "blocked writes: none — the dry run touched no table"
      : `blocked writes: ${blocked.length} (${[...new Set(blocked.map((w) => `${w.table}.${w.method}`))].join(", ")})`,
  );
  const auditBytes = auditRecords.reduce(
    (sum, r) => sum + Buffer.byteLength(JSON.stringify(r)),
    0,
  );
  console.log(
    `audit spans: ${auditRecords.length} rows, ${auditBytes} bytes serialized (captured at the seam, never written)`,
  );
  const cache = httpCacheStats();
  console.log(
    `http cache: ${cache.recorded} recorded, ${cache.replayed} replayed, ${cache.passthrough} passthrough (OpenAI + Supabase)`,
  );
}

void main().catch((e) => {
  console.error(
    "\nFAILED:",
    e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e),
  );
  process.exitCode = 1;
});

export {};
