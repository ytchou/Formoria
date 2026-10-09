/**
 * @formoria-script
 * purpose: Re-syncs brands.hero_image_storage_path for approved brands whose hero copy still names a private submissions/ key.
 * class: operator
 * invoke: pnpm exec tsx scripts/enrichment/images/repair-hero-storage-paths.ts
 * target: staging-default
 * safety: dry-run-default
 * owner: engineering
 * notes: DEV-1989 SP2-33; writes a rollback JSON to scripts/backup/ before any write.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";
import { isPublicStorageKey } from "@/lib/images/storage-keys";
import {
  getBrandImages,
  syncHeroDenormalized,
} from "@/lib/services/brand-images";
import { createServiceClient } from "@/lib/supabase/service";

import {
  assertRevalidationConfigured,
  fetchAllRows,
  parseApplyOption,
} from "../products/curated-products/shared";
import { loadScriptTarget } from "../../shared/target";

/**
 * Repairs the hero copy promotion leaves behind (DEV-1989, SP2-33).
 *
 *   pnpm exec tsx scripts/enrichment/images/repair-hero-storage-paths.ts            # dry run
 *   …--apply                                                                        # write
 *   …--target=production                                                            # defaults to staging
 *
 * `promote-submission-images` moves a `brand_images` row from `submissions/`
 * to `brands/` but never touches `brands.hero_image_storage_path`, the
 * denormalized copy of the brand's lead image. A brand approved before the
 * promotion therefore keeps a `submissions/` hero key, and `/i/submissions/…`
 * answers 400 by design — the home brand strip and the join example card
 * showed exactly that on staging (54 approved brands, 2026-10-09).
 *
 * The fix is the existing `syncHeroDenormalized`, the one writer that already
 * owns the hero copy: it sets it to the brand's first active image by
 * `sort_order`. This script only selects the brands that need it and records
 * the before/after. A brand with no active public image is reported and left
 * alone; the read side already renders no hero for a private key.
 *
 * Ceiling: the promotion sweep still leaves new stale copies behind. Upgrade
 * path: call `syncHeroDenormalized` from the sweep for every brand it promoted.
 */

const PAGE_SIZE = 500;

export type HeroRow = {
  id: string;
  slug: string;
  hero_image_storage_path: string | null;
};

export type HeroPlan = {
  /** Brands whose hero key is set but cannot be served publicly. */
  stale: HeroRow[];
};

/** PURE: the brands whose stored hero key is a non-public key. */
export function planHeroRepairs(rows: readonly HeroRow[]): HeroPlan {
  return {
    stale: rows.filter((row) => {
      const key = row.hero_image_storage_path?.trim();
      return Boolean(key) && !isPublicStorageKey(key!);
    }),
  };
}

export type HeroChange = {
  id: string;
  slug: string;
  before: string | null;
  after: string | null;
};

/**
 * PURE: what `syncHeroDenormalized` would write — the first active image's
 * key — kept only when that key is public. A brand with none is unrepairable
 * here and is reported, never written.
 */
export function planHeroChange(
  row: HeroRow,
  activeKeysBySortOrder: readonly (string | null | undefined)[],
): HeroChange | null {
  const first = activeKeysBySortOrder.at(0)?.trim() ?? null;
  if (!first || !isPublicStorageKey(first)) return null;
  return {
    id: row.id,
    slug: row.slug,
    before: row.hero_image_storage_path,
    after: first,
  };
}

async function main(): Promise<void> {
  const { target, argv } = loadScriptTarget();
  const apply = parseApplyOption(argv);
  const revalidate = target !== "staging";
  if (apply && revalidate) assertRevalidationConfigured();

  const supabase = createServiceClient();
  const rows = await fetchAllRows<HeroRow>(
    "brands",
    (from, to) =>
      supabase
        .from("brands")
        .select("id, slug, hero_image_storage_path")
        .eq("status", "approved")
        .not("hero_image_storage_path", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    PAGE_SIZE,
  );
  const { stale } = planHeroRepairs(rows);

  const changes: HeroChange[] = [];
  const unrepairable: string[] = [];
  for (const row of stale) {
    const images = await getBrandImages(supabase, row.id);
    const change = planHeroChange(
      row,
      images.map((image) => image.storage_path),
    );
    if (change) changes.push(change);
    else unrepairable.push(row.slug);
  }

  // Before any write, dry run included: the rollback is the old key per brand.
  mkdirSync("scripts/backup", { recursive: true });
  const rollback = `scripts/backup/repair-hero-storage-paths-${target}-${new Date()
    .toISOString()
    .replace(/:/g, "-")}.json`;
  writeFileSync(rollback, JSON.stringify(changes, null, 2));

  for (const change of changes) {
    console.log(`${change.slug} | ${change.before} → ${change.after}`);
  }
  for (const slug of unrepairable) {
    console.log(JSON.stringify({ unrepairable: slug }));
  }

  const failures: string[] = [];
  let written = 0;
  if (apply) {
    for (const change of changes) {
      try {
        await syncHeroDenormalized(supabase, change.id);
        written += 1;
      } catch (error: unknown) {
        failures.push(
          `${change.slug}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  console.log(
    JSON.stringify({
      target,
      mode: apply ? "apply" : "dry-run",
      approvedWithHero: rows.length,
      stale: stale.length,
      repairable: changes.length,
      unrepairable: unrepairable.length,
      written,
      failures: failures.length,
      rollback,
    }),
  );
  for (const failure of failures)
    console.log(JSON.stringify({ failed: failure }));
  if (failures.length > 0) process.exitCode = 1;

  if (!apply) {
    console.log("No changes made. Re-run with --apply to write.");
    return;
  }
  if (written === 0) return;
  if (!revalidate) {
    console.log(
      JSON.stringify({
        revalidation: "skipped",
        reason:
          "staging has no revalidation route; pages refresh by ISR (1h) or a staging redeploy",
      }),
    );
    return;
  }
  const slugs = changes.map((change) => change.slug);
  const revalidation = await requestPublicBrandRevalidation(slugs);
  console.log(
    JSON.stringify({ revalidated: slugs.length, ok: revalidation.ok }),
  );
  if (!revalidation.ok) {
    throw new Error(
      `revalidation failed (${revalidation.reason ?? "unknown"}): brand pages are stale`,
    );
  }
}

// The test imports the pure functions, so importing this module must never
// start a run.
if (process.argv[1]?.endsWith("images/repair-hero-storage-paths.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
