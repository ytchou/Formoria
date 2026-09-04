/**
 * Submit the 9 proof brands for DEV-1692 channel/budget evaluation.
 *
 * Reads proof-brands.json and calls submitBrandForReview for each entry.
 * Uses service-role auth so no real user session is needed.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.staging scripts/dev-1692/submit-proof-brands.ts
 *   pnpm exec tsx --env-file=.env.staging scripts/dev-1692/submit-proof-brands.ts --apply
 *   pnpm exec tsx --env-file=.env.staging scripts/dev-1692/submit-proof-brands.ts --apply --out ids.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { submitBrandForReview } from "@/lib/services/submission-pipeline";

type ProofBrand = {
  slug: string;
  brandName: string;
  websiteUrl?: string;
  instagram?: string;
};

const APPLY = process.argv.includes("--apply");

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv.at(index + 1);
}

const SUBMITTER_EMAIL = "dev-1692@formoria.com";

async function main(): Promise<void> {
  const brands: ProofBrand[] = JSON.parse(
    readFileSync(join(dirname(import.meta.url.replace("file://", "")), "proof-brands.json"), "utf8"),
  );

  console.log(`[submit-proof] ${brands.length} brands loaded`);

  if (!APPLY) {
    console.log("[submit-proof] dry run — pass --apply to submit");
    for (const brand of brands) {
      console.log(`  ${brand.slug}: ${brand.brandName}`);
    }
    return;
  }

  const ids: string[] = [];

  for (const brand of brands) {
    const idempotencyKey = `dev-1692:${brand.slug}`;
    console.log(`[submit-proof] submitting ${brand.slug} (${idempotencyKey})…`);

    const result = await submitBrandForReview(
      {
        idempotencyKey,
        brandName: brand.brandName,
        websiteUrl: brand.websiteUrl,
        submitterEmail: SUBMITTER_EMAIL,
        socialLinks: brand.instagram
          ? { instagram: brand.instagram }
          : undefined,
      },
      { useServiceRole: true },
    );

    console.log(`  → submission ${result.submissionId}`);
    ids.push(result.submissionId);
  }

  const outPath = argValue("--out");
  if (outPath) {
    const resolved = resolve(outPath);
    writeFileSync(resolved, ids.join("\n") + "\n");
    console.log(`[submit-proof] wrote ${ids.length} ids to ${resolved}`);
  } else {
    console.log(`[submit-proof] ids:\n${ids.join("\n")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
