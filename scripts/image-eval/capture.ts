import { isPrivateUrl } from "@/lib/url";
import { processImage } from "@/lib/security/image-processor";
import {
  batchCaptureBrandImages,
  type SerperRawImageCandidate,
} from "@/lib/services/enrich-phases/scraper/search";
import { brandTarget } from "@/lib/services/enrichment-target";
import { createServiceClient } from "@/lib/supabase/server";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { uploadImageEvalAsset } from "@/lib/services/image-eval-storage";
import {
  CORPUS_ROOT,
  MANIFEST_PATH,
  ROSTER_PATH,
  RUN_ROOT,
  ensureEvalDirectories,
  readJson,
  runPath,
  writeJsonAtomic,
} from "./lib/paths";
import { sha256, stableImageId } from "./lib/hash";
import { countSplits, splitRoster } from "./lib/split";
import {
  buildCaptureQueries,
  mergeCaptureCandidates,
  underfilledCaptureBrands,
} from "./lib/capture";
import {
  EVAL_CATEGORY_SLUGS,
  EVAL_SCHEMA_VERSION,
  type GoldenImageEntry,
  type GoldenManifest,
  type GoldenRosterBrand,
} from "./lib/types";

const EXPECTED_BRAND_COUNT = 50;
const EXPECTED_IMAGE_COUNT = 500;
const MAX_CANDIDATES_PER_BRAND = EXPECTED_IMAGE_COUNT / EXPECTED_BRAND_COUNT;
const BRANDS_PER_CATEGORY = 5;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

type DatabaseBrand = {
  id: string;
  slug: string;
  name: string;
  product_type: string | null;
  purchase_website: string | null;
};

type CapturedOutcome = {
  candidates: SerperRawImageCandidate[];
  candidateQueries: Map<string, string>;
  rawResponses: unknown[];
  callStatuses: string[];
  errors: string[];
};

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function loadOrCreateRoster(
  force: boolean,
): Promise<GoldenRosterBrand[]> {
  try {
    const roster = await readJson<GoldenRosterBrand[]>(ROSTER_PATH);
    if (!force) return roster;
  } catch {
    // First capture creates the durable roster.
  }

  const { data, error } = await createServiceClient()
    .from("brands")
    .select("id, slug, name, product_type, purchase_website")
    .eq("status", "approved")
    .in("product_type", [...EVAL_CATEGORY_SLUGS])
    .order("slug", { ascending: true });

  if (error) throw error;

  const byCategory = new Map<string, DatabaseBrand[]>();
  for (const row of (data ?? []) as DatabaseBrand[]) {
    if (!row.product_type) continue;
    const category = byCategory.get(row.product_type) ?? [];
    category.push(row);
    byCategory.set(row.product_type, category);
  }

  const selected: Omit<GoldenRosterBrand, "split">[] = [];
  for (const category of EVAL_CATEGORY_SLUGS) {
    const brands = (byCategory.get(category) ?? [])
      .toSorted((left, right) => left.slug.localeCompare(right.slug))
      .slice(0, BRANDS_PER_CATEGORY);
    if (brands.length !== BRANDS_PER_CATEGORY) {
      throw new Error(
        `Need ${BRANDS_PER_CATEGORY} approved brands in ${category}; found ${brands.length}`,
      );
    }
    selected.push(
      ...brands.map((brand) => ({
        id: brand.id,
        slug: brand.slug,
        name: brand.name,
        productType: category,
        purchaseWebsite: brand.purchase_website,
      })),
    );
  }

  if (selected.length !== EXPECTED_BRAND_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_BRAND_COUNT} roster brands; selected ${selected.length}`,
    );
  }

  const roster = splitRoster(selected);
  await writeJsonAtomic(ROSTER_PATH, roster);
  return roster;
}

function imageDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function readableError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function captureSerperCandidates(
  roster: GoldenRosterBrand[],
): Promise<Map<string, CapturedOutcome>> {
  const byName = new Map(roster.map((brand) => [brand.name, brand]));
  const queriesByName = new Map(
    roster.map((brand) => [
      brand.name,
      buildCaptureQueries({
        name: brand.name,
        productType: brand.productType,
        purchaseWebsite: brand.purchaseWebsite,
      }),
    ]),
  );
  const outcomes = new Map<string, CapturedOutcome>(
    roster.map((brand) => [
      brand.name,
      {
        candidates: [],
        candidateQueries: new Map(),
        rawResponses: [],
        callStatuses: [],
        errors: [],
      },
    ]),
  );
  const queryRoundCount = Math.max(
    ...[...queriesByName.values()].map((queries) => queries.length),
  );

  for (let round = 0; round < queryRoundCount; round += 1) {
    const pending = roster.filter(
      (brand) =>
        (outcomes.get(brand.name)?.candidates.length ?? 0) <
        MAX_CANDIDATES_PER_BRAND,
    );
    if (pending.length === 0) break;

    console.log(
      `  image query round ${round + 1}/${queryRoundCount}: ${pending.length} underfilled brands`,
    );
    const roundOutcomes = await batchCaptureBrandImages(
      pending.map((brand) => brand.name),
      5,
      (brandName) =>
        queriesByName.get(brandName)?.[round] ??
        queriesByName.get(brandName)?.[0] ??
        brandName,
      (input) => {
        const brandName = typeof input === "string" ? input : input.brandName;
        const brand = byName.get(brandName);
        if (!brand) throw new Error(`Missing roster brand for ${brandName}`);
        return {
          target: brandTarget(brand.id),
          attempt: round + 1,
          config: { captureRound: round + 1 },
        };
      },
    );

    for (const [brandName, roundOutcome] of roundOutcomes) {
      const outcome = outcomes.get(brandName);
      if (!outcome) continue;
      outcome.rawResponses.push(roundOutcome.rawResponse);
      outcome.callStatuses.push(roundOutcome.callStatus);
      if (roundOutcome.error) outcome.errors.push(roundOutcome.error);

      const existingUrls = new Set(
        outcome.candidates.map((candidate) => candidate.imageUrl),
      );
      outcome.candidates = mergeCaptureCandidates(
        outcome.candidates,
        roundOutcome.candidates,
        MAX_CANDIDATES_PER_BRAND,
      );
      for (const candidate of roundOutcome.candidates) {
        if (existingUrls.has(candidate.imageUrl)) continue;
        if (
          outcome.candidates.some(
            (current) => current.imageUrl === candidate.imageUrl,
          )
        ) {
          outcome.candidateQueries.set(candidate.imageUrl, roundOutcome.query);
        }
      }
    }
  }

  return outcomes;
}

async function fetchAndNormalize(urls: string[]): Promise<
  | {
      fetchUrl: string;
      buffer: Buffer;
      width: number;
      height: number;
    }
  | { failureReason: string }
> {
  const failures: string[] = [];
  for (const url of [...new Set(urls.filter(Boolean))]) {
    if (isPrivateUrl(url)) {
      failures.push("private URL");
      continue;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { Accept: "image/*", "User-Agent": "Formoria-Image-Eval/1.0" },
      });
      const resolvedUrl = response.url || url;
      if (isPrivateUrl(resolvedUrl)) {
        failures.push("redirected to private URL");
        continue;
      }
      if (!response.ok) {
        failures.push(`HTTP ${response.status}`);
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("image/")) {
        failures.push(
          `not an image (${contentType || "missing content-type"})`,
        );
        continue;
      }
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAX_INPUT_BYTES) {
        failures.push(`response too large (${contentLength} bytes)`);
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_INPUT_BYTES) {
        failures.push(`response too large (${buffer.length} bytes)`);
        continue;
      }

      const processed = await processImage(buffer, {
        maxWidth: 1600,
        maxHeight: 1600,
        maxFileSizeBytes: MAX_INPUT_BYTES,
        quality: 88,
      });
      return {
        fetchUrl: resolvedUrl,
        buffer: processed.buffer,
        width: processed.width,
        height: processed.height,
      };
    } catch (error) {
      failures.push(readableError(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    failureReason: failures.join("; ").slice(0, 500) || "no downloadable URL",
  };
}

async function capture(): Promise<void> {
  await ensureEvalDirectories();
  const force = hasFlag("--force");
  if (!force) {
    try {
      await readFile(MANIFEST_PATH);
      throw new Error(
        `A frozen manifest already exists at ${MANIFEST_PATH}; use --force only to replace it intentionally`,
      );
    } catch (error) {
      if (error instanceof Error && !/ENOENT/.test(error.message)) throw error;
    }
  }

  const roster = await loadOrCreateRoster(force);
  const runId = `capture-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await mkdir(join(RUN_ROOT, runId), { recursive: true });

  const outcomes = await captureSerperCandidates(roster);

  await writeJsonAtomic(
    runPath(runId, "serper-responses.json"),
    Object.fromEntries(
      [...outcomes.entries()].map(([brandName, outcome]) => [
        brandName,
        {
          responses: outcome.rawResponses,
          callStatuses: outcome.callStatuses,
          errors: outcome.errors,
        },
      ]),
    ),
  );

  const rawCandidates = [...outcomes.entries()].flatMap(
    ([brandName, outcome]) => {
      const brand = roster.find((candidate) => candidate.name === brandName);
      if (!brand) return [];
      const firstQuery =
        buildCaptureQueries({
          name: brand.name,
          productType: brand.productType,
          purchaseWebsite: brand.purchaseWebsite,
        })[0] ?? brand.name;
      return outcome.candidates.map((candidate, index) => ({
        brand,
        candidate,
        index,
        query: outcome.candidateQueries.get(candidate.imageUrl) ?? firstQuery,
      }));
    },
  );

  if (rawCandidates.length !== EXPECTED_IMAGE_COUNT) {
    const underfilledBrands = underfilledCaptureBrands(
      [...outcomes.entries()].map(([name, outcome]) => ({
        name,
        count: outcome.candidates.length,
      })),
      MAX_CANDIDATES_PER_BRAND,
    );
    await writeJsonAtomic(runPath(runId, "capture-report.json"), {
      runId,
      expected: EXPECTED_IMAGE_COUNT,
      received: rawCandidates.length,
      underfilledBrands,
      statuses: Object.fromEntries(
        [...outcomes.entries()].map(([name, outcome]) => [
          name,
          {
            candidateCount: outcome.candidates.length,
            callStatuses: outcome.callStatuses,
            errors: outcome.errors,
          },
        ]),
      ),
    });
    throw new Error(
      `Expected ${EXPECTED_IMAGE_COUNT} raw Serper image candidates; received ${rawCandidates.length}. Underfilled brands: ${underfilledBrands.join(", ") || "none"}. See ${runPath(runId, "capture-report.json")}`,
    );
  }

  const entries: GoldenImageEntry[] = [];
  let readyCount = 0;
  for (const { brand, candidate, index, query } of rawCandidates) {
    const sourceUrl = candidate.imageUrl;
    const id = stableImageId({
      brandSlug: brand.slug,
      query,
      position: candidate.position ?? index + 1,
      sourceUrl,
    });
    const objectPath = `corpus/${id}.webp`;
    const normalized = await fetchAndNormalize([
      sourceUrl,
      candidate.thumbnailUrl ?? "",
    ]);
    const entry: GoldenImageEntry = {
      id,
      brandId: brand.id,
      brandSlug: brand.slug,
      brandName: brand.name,
      category: brand.productType,
      split: brand.split,
      query,
      position: candidate.position ?? index + 1,
      sourceUrl,
      fetchUrl: "fetchUrl" in normalized ? normalized.fetchUrl : null,
      pageUrl: candidate.link ?? null,
      previewUrl: candidate.thumbnailUrl ?? null,
      title: candidate.title,
      source: candidate.source ?? null,
      domain: candidate.domain ?? imageDomain(sourceUrl),
      providerWidth: candidate.imageWidth ?? null,
      providerHeight: candidate.imageHeight ?? null,
      thumbnailWidth: candidate.thumbnailWidth ?? null,
      thumbnailHeight: candidate.thumbnailHeight ?? null,
      googleUrl: candidate.googleUrl ?? null,
      captureStatus: "fetchUrl" in normalized ? "ready" : "unavailable",
      failureReason: "fetchUrl" in normalized ? null : normalized.failureReason,
      objectPath: "fetchUrl" in normalized ? objectPath : null,
      checksumSha256:
        "fetchUrl" in normalized ? sha256(normalized.buffer) : null,
      contentType: "fetchUrl" in normalized ? "image/webp" : null,
      width: "fetchUrl" in normalized ? normalized.width : null,
      height: "fetchUrl" in normalized ? normalized.height : null,
      bytes: "fetchUrl" in normalized ? normalized.buffer.length : null,
    };
    if ("fetchUrl" in normalized) {
      await uploadImageEvalAsset(objectPath, normalized.buffer);
      readyCount += 1;
    }
    entries.push(entry);
    if (entries.length % 25 === 0) {
      console.log(
        `  captured ${entries.length}/${EXPECTED_IMAGE_COUNT} (${readyCount} ready)`,
      );
    }
  }

  const manifest: GoldenManifest = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    corpusId: `dev-1279-serper-${runId}`,
    capturedAt: new Date().toISOString(),
    source: "serper.images",
    roster,
    entries,
  };
  await writeJsonAtomic(MANIFEST_PATH, manifest);
  await writeJsonAtomic(ROSTER_PATH, roster);
  await writeJsonAtomic(runPath(runId, "capture-report.json"), {
    runId,
    corpusId: manifest.corpusId,
    rawCount: entries.length,
    readyCount,
    unavailableCount: entries.length - readyCount,
    splitCounts: countSplits(roster),
    manifestSha256: sha256(JSON.stringify(manifest)),
  });
  console.log(
    `Capture complete: ${entries.length} raw candidates, ${readyCount} ready for labeling`,
  );
  console.log(`Manifest: ${CORPUS_ROOT}/manifest.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void capture().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
