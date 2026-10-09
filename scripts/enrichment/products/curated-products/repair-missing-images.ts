/**
 * @formoria-script
 * purpose: Finds staging image rows whose public storage object is missing, mirrors those present on production public storage, and on --clear-dangling clears dangling curated-product images.
 * class: operator
 * invoke: pnpm exec tsx scripts/enrichment/products/curated-products/repair-missing-images.ts
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 * notes: Staging only; refuses --target=production. Production is read only through anonymous public object URLs.
 */
import { writeFileSync } from "node:fs";

import { storagePathFromImageUrl } from "@/lib/images/image-url";
import {
  BRAND_IMAGES_BUCKET,
  resolveImageStorageLocation,
} from "@/lib/images/storage-keys";
import { mapWithConcurrency } from "@/lib/services/_shared/concurrency";
import { uploadWithRetry } from "@/lib/services/storage-retry";
import { createServiceClient } from "@/lib/supabase/service";
import { PRODUCTION_PROJECT_REF } from "@/lib/supabase/project-target";

import { loadScriptTarget } from "../../../shared/target";
import { STAGING_REVALIDATION_SKIPPED } from "./normalize-names";
import { fetchAllRows, parseApplyOption } from "./shared";

/**
 * Repairs the staging image gap (DEV-1989, SP2-33).
 *
 *   pnpm exec tsx scripts/enrichment/products/curated-products/repair-missing-images.ts
 *   …--include-candidates    also check brand_images rows in status 'candidate'
 *   …--apply                 mirror the mirrorable objects (dry run without it)
 *   …--clear-dangling        with --apply: clear dangling curated-product images
 *   …--report=<path>         JSON report path; defaults to
 *                            repair-missing-images-<timestamp>.json in the cwd
 *
 * Staging is a copy of production's rows, not of its Storage objects, so some
 * rows point at keys staging never received. Measured read-only on 2026-10-09:
 * of 1,356 visible curated products with an image, 11 point at objects missing
 * on both projects; of the active brand_images, 67 rows (27 brands) are missing
 * on staging but present at the same key on production, and 9 on both.
 *
 * Each public key is HEADed on staging's public URL, then — only when staging
 * misses — on production's. A row is `ok`, `mirrorable` (staging misses,
 * production has it), `dangling` (both miss) or `unknown` (any other answer:
 * a 5xx, a 429, a network error). `unknown` is never written: like
 * flag-commerce-images, this script fails open, because clearing an image on a
 * transient error would destroy a good row.
 *
 * STAGING ONLY. `--target=production` throws before any read. Production is
 * touched only by anonymous HEAD/GET of public object URLs, never with
 * credentials; `PRODUCTION_PROJECT_REF` is used for nothing but building them.
 *
 * WRITE SCOPE on `--apply`:
 *   - mirrorable keys: the production bytes are uploaded to staging's
 *     `brand-images` bucket at the SAME key with the original content type,
 *     `upsert: false` (a key that appeared meanwhile is never overwritten),
 *     then re-HEADed on staging to confirm. No row changes.
 *   - with `--clear-dangling`: dangling curated_products rows get
 *     `image_url`, `image_width`, `image_height` → NULL through the service
 *     `updateCuratedProduct`, as flag-commerce-images does; the renderable-image
 *     gate then hides the product. The old image_url is in the report, which
 *     is the rollback.
 *
 * Shortcuts, with their ceilings:
 *   - Dangling brand_images rows are REPORTED, NEVER WRITTEN. No service owns
 *     retiring a brand image safely here (hero ordering and sort_order belong
 *     to the brand-image flows). Upgrade path: route them through the owner
 *     or admin image-removal service once one takes a row id.
 *   - Keys that do not resolve to a public key (an external url, or a legacy
 *     full storage url naming another project) are counted as `unresolved` and
 *     skipped, not probed.
 *   - No revalidation: staging has no revalidation route (see
 *     normalize-names.ts). Pages pick the change up by ISR or a redeploy.
 */

const PAGE_SIZE = 500;
/** Anonymous HEADs against public CDN urls: cheap, but kept polite. */
const CONCURRENCY = 8;
const HEAD_TIMEOUT_MS = 15_000;

/** Supabase public storage answers a missing object with 400, sometimes 404. */
const MISSING_STATUSES = new Set([400, 404]);

type BrandEmbed = { slug: string } | { slug: string }[] | null | undefined;

function slugOf(brands: BrandEmbed): string | null {
  const brand = Array.isArray(brands) ? brands[0] : brands;
  return brand?.slug ?? null;
}

export type CuratedImageRow = {
  id: string;
  image_url: string | null;
  brands?: BrandEmbed;
};

export type BrandImageRow = {
  id: string;
  url: string;
  storage_path: string | null;
  status: string;
  brands?: BrandEmbed;
};

export type ImageRef = {
  kind: "curated_product" | "brand_image";
  id: string;
  brandSlug: string | null;
  key: string;
  imageUrl: string;
  /** brand_images only. */
  status?: string;
};

/** Only keys in the public `brand-images` bucket are checked. */
function publicKey(key: string | null): string | null {
  if (!key) return null;
  return resolveImageStorageLocation(key)?.visibility === "public" ? key : null;
}

export function curatedProductImageRef(row: CuratedImageRow): ImageRef | null {
  const key = publicKey(storagePathFromImageUrl(row.image_url));
  if (!key || !row.image_url) return null;
  return {
    kind: "curated_product",
    id: row.id,
    brandSlug: slugOf(row.brands),
    key,
    imageUrl: row.image_url,
  };
}

export function brandImageRef(row: BrandImageRow): ImageRef | null {
  const key = publicKey(row.storage_path ?? storagePathFromImageUrl(row.url));
  if (!key) return null;
  return {
    kind: "brand_image",
    id: row.id,
    brandSlug: slugOf(row.brands),
    key,
    imageUrl: row.url,
    status: row.status,
  };
}

export function publicObjectUrl(projectRef: string, key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `https://${projectRef}.supabase.co/storage/v1/object/public/${BRAND_IMAGES_BUCKET}/${path}`;
}

/** HTTP status of a HEAD, or 0 on a network error or timeout. Injected by the test. */
export type HeadStatus = (url: string) => Promise<number>;

export type ImageState = "ok" | "mirrorable" | "dangling" | "unknown";

export type ClassifiedImage = {
  ref: ImageRef;
  state: ImageState;
  stagingStatus: number;
  /** Null when production was not probed (staging answered 200 or non-missing). */
  productionStatus: number | null;
};

type KeyState = Omit<ClassifiedImage, "ref">;

/**
 * HEADs each distinct key once (rows may share a key), staging first,
 * production only when staging reports the object missing. Input order is
 * kept, so two runs print the same list.
 */
export async function classifyImageRefs({
  refs,
  head,
  stagingRef,
  productionRef,
  concurrency = CONCURRENCY,
}: {
  refs: readonly ImageRef[];
  head: HeadStatus;
  stagingRef: string;
  productionRef: string;
  concurrency?: number;
}): Promise<ClassifiedImage[]> {
  const byKey = new Map<string, Promise<KeyState>>();

  const probe = async (key: string): Promise<KeyState> => {
    const stagingStatus = await head(publicObjectUrl(stagingRef, key));
    if (stagingStatus === 200) {
      return { state: "ok", stagingStatus, productionStatus: null };
    }
    if (!MISSING_STATUSES.has(stagingStatus)) {
      return { state: "unknown", stagingStatus, productionStatus: null };
    }
    const productionStatus = await head(publicObjectUrl(productionRef, key));
    const state: ImageState =
      productionStatus === 200
        ? "mirrorable"
        : MISSING_STATUSES.has(productionStatus)
          ? "dangling"
          : "unknown";
    return { state, stagingStatus, productionStatus };
  };

  return mapWithConcurrency(refs, concurrency, async (ref) => {
    let pending = byKey.get(ref.key);
    if (!pending) {
      pending = probe(ref.key);
      byKey.set(ref.key, pending);
    }
    return { ref, ...(await pending) };
  });
}

export type RepairDeps = {
  head: HeadStatus;
  /** Copies one key's production public bytes into staging's bucket. */
  mirror: (key: string) => Promise<void>;
  /** Clears one curated product's stored image. */
  clearImage: (id: string) => Promise<void>;
};

export type ClearedImage = {
  id: string;
  brandSlug: string | null;
  /** The rollback: write this back to `image_url` to restore the row. */
  oldImageUrl: string;
};

export type RepairReport = {
  /** Keys uploaded AND confirmed by a staging re-HEAD. */
  mirrored: string[];
  cleared: ClearedImage[];
  /** Dangling brand_images row ids: never written, see the header. */
  danglingBrandImagesReportOnly: string[];
  failures: string[];
};

/**
 * Sequential on purpose: a few dozen uploads finish in seconds, and one at a
 * time keeps the output in plan order. One failed key or row is carried, never
 * thrown, so a run never stops after an arbitrary prefix.
 */
export async function repairImages({
  classified,
  apply,
  clearDangling,
  stagingRef,
  deps,
}: {
  classified: readonly ClassifiedImage[];
  apply: boolean;
  clearDangling: boolean;
  stagingRef: string;
  deps: RepairDeps;
}): Promise<RepairReport> {
  const report: RepairReport = {
    mirrored: [],
    cleared: [],
    danglingBrandImagesReportOnly: classified
      .filter((entry) => entry.state === "dangling" && entry.ref.kind === "brand_image")
      .map((entry) => entry.ref.id),
    failures: [],
  };
  if (!apply) return report;

  const mirrorKeys = [
    ...new Set(
      classified
        .filter((entry) => entry.state === "mirrorable")
        .map((entry) => entry.ref.key),
    ),
  ];
  for (const key of mirrorKeys) {
    try {
      await deps.mirror(key);
      const status = await deps.head(publicObjectUrl(stagingRef, key));
      if (status === 200) report.mirrored.push(key);
      else {
        report.failures.push(
          `mirror ${key}: staging still answers ${status} after upload`,
        );
      }
    } catch (error: unknown) {
      report.failures.push(`mirror ${key}: ${errorMessage(error)}`);
    }
  }

  if (!clearDangling) return report;

  for (const entry of classified) {
    if (entry.state !== "dangling" || entry.ref.kind !== "curated_product") continue;
    try {
      await deps.clearImage(entry.ref.id);
      report.cleared.push({
        id: entry.ref.id,
        brandSlug: entry.ref.brandSlug,
        oldImageUrl: entry.ref.imageUrl,
      });
    } catch (error: unknown) {
      report.failures.push(`clear ${entry.ref.id}: ${errorMessage(error)}`);
    }
  }

  return report;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const headPublicObject: HeadStatus = async (url) => {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    return response.status;
  } catch {
    return 0;
  }
};

/**
 * GETs the production PUBLIC object anonymously and uploads it to staging.
 * `upsert: false` with a retry: a timed-out attempt that actually landed makes
 * the retry fail with "already exists", which is treated as done — the
 * caller's staging re-HEAD is what decides success.
 */
async function mirrorFromProduction(key: string): Promise<void> {
  const response = await fetch(publicObjectUrl(PRODUCTION_PROJECT_REF, key));
  if (!response.ok) throw new Error(`production GET answered ${response.status}`);
  const contentType =
    response.headers.get("content-type") ?? "application/octet-stream";
  const body = new Uint8Array(await response.arrayBuffer());

  const supabase = createServiceClient();
  const { error } = await uploadWithRetry(() =>
    supabase.storage
      .from(BRAND_IMAGES_BUCKET)
      .upload(key, body, { contentType, upsert: false }),
  );
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(error.message);
  }
}

async function loadRefs(includeCandidates: boolean): Promise<{
  refs: ImageRef[];
  selected: number;
  unresolved: number;
}> {
  const supabase = createServiceClient();
  const curated = await fetchAllRows<CuratedImageRow>(
    "curated_products",
    (from, to) =>
      supabase
        .from("curated_products")
        .select("id, image_url, brands(slug)")
        .eq("visible", true)
        .not("image_url", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    PAGE_SIZE,
  );
  const statuses = includeCandidates ? ["active", "candidate"] : ["active"];
  const brandImages = await fetchAllRows<BrandImageRow>(
    "brand_images",
    (from, to) =>
      supabase
        .from("brand_images")
        .select("id, url, storage_path, status, brands(slug)")
        .in("status", statuses)
        .order("id", { ascending: true })
        .range(from, to),
    PAGE_SIZE,
  );

  const refs: ImageRef[] = [];
  let unresolved = 0;
  for (const row of curated) {
    const ref = curatedProductImageRef(row);
    if (ref) refs.push(ref);
    else unresolved += 1;
  }
  for (const row of brandImages) {
    const ref = brandImageRef(row);
    if (ref) refs.push(ref);
    else unresolved += 1;
  }
  return { refs, selected: curated.length + brandImages.length, unresolved };
}

function parseReportPath(argv: readonly string[]): string | null {
  const arg = argv.find((value) => value.startsWith("--report="));
  if (!arg) return null;
  const path = arg.slice("--report=".length);
  if (!path) throw new Error("--report requires a file path");
  return path;
}

async function main(): Promise<void> {
  const { target, projectRef, argv } = loadScriptTarget();
  if (target !== "staging") {
    throw new Error(
      "repair-missing-images is staging-only: it copies production's public objects INTO staging",
    );
  }
  const apply = parseApplyOption(argv);
  const clearDangling = argv.includes("--clear-dangling");
  const includeCandidates = argv.includes("--include-candidates");
  const reportPath =
    parseReportPath(argv) ??
    `repair-missing-images-${new Date().toISOString().replaceAll(":", "-")}.json`;

  const { refs, selected, unresolved } = await loadRefs(includeCandidates);
  const classified = await classifyImageRefs({
    refs,
    head: headPublicObject,
    stagingRef: projectRef,
    productionRef: PRODUCTION_PROJECT_REF,
  });
  // Imported here, not at the top: the test imports this module for its pure
  // functions and has no reason to load the whole curated-product service.
  const { updateCuratedProduct } = await import(
    "@/lib/services/curated-products"
  );
  const report = await repairImages({
    classified,
    apply,
    clearDangling,
    stagingRef: projectRef,
    deps: {
      head: headPublicObject,
      mirror: mirrorFromProduction,
      clearImage: (id) =>
        updateCuratedProduct(id, {
          imageUrl: null,
          imageWidth: null,
          imageHeight: null,
        }),
    },
  });

  const count = (state: ImageState, kind?: ImageRef["kind"]) =>
    classified.filter(
      (entry) => entry.state === state && (!kind || entry.ref.kind === kind),
    ).length;
  const flagged = classified.filter((entry) => entry.state !== "ok");

  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        target,
        projectRef,
        mode: apply ? "apply" : "dry-run",
        clearDangling,
        includeCandidates,
        selected,
        unresolved,
        flagged,
        ...report,
      },
      null,
      2,
    )}\n`,
  );

  for (const entry of flagged) {
    console.log(
      [
        entry.state,
        entry.ref.kind,
        entry.ref.id,
        entry.ref.brandSlug ?? "-",
        entry.ref.key,
      ].join(" | "),
    );
  }
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      selected,
      unresolved,
      probed: classified.length,
      ok: count("ok"),
      mirrorable: count("mirrorable"),
      danglingCuratedProducts: count("dangling", "curated_product"),
      danglingBrandImages: count("dangling", "brand_image"),
      unknown: count("unknown"),
      mirrored: report.mirrored.length,
      cleared: report.cleared.length,
      failures: report.failures.length,
      report: reportPath,
    }),
  );
  for (const failure of report.failures) {
    console.log(JSON.stringify({ failed: failure }));
  }
  // A run that could not classify or repair every row is not a complete run.
  if (report.failures.length > 0 || count("unknown") > 0) process.exitCode = 1;

  if (!apply) {
    console.log("No changes made. Re-run with --apply to write.");
    return;
  }
  if (report.mirrored.length > 0 || report.cleared.length > 0) {
    console.log(JSON.stringify(STAGING_REVALIDATION_SKIPPED));
  }
}

// The test imports the pure functions from this module, so importing it must
// never start a run. `main()` fires only when this file IS the process entry
// point — under vitest argv[1] is the runner, not this file.
if (process.argv[1]?.endsWith("curated-products/repair-missing-images.ts")) {
  void main().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
