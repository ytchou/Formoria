/**
 * @formoria-script
 * purpose: Derives brand_channels.district from each stockist address and region label.
 * class: operator
 * invoke: pnpm exec tsx scripts/backfill-channel-district.ts
 * target: staging-default
 * safety: dry-run-default
 * owner: engineering
 * notes: pending one-off: 1191 rows on 2026-09-02
 */
import { citySlugFromName } from "@/lib/constants/taiwan-cities";
import { matchDistrict } from "@/lib/brands/district";
import {
  listStockistDistrictBackfillRows,
  updateStockistDistricts,
} from "@/lib/services/stockists";
import { loadScriptTarget } from "./shared/target";

const APPLY = process.argv.includes("--apply");

async function main() {
  loadScriptTarget();
  const rows = await listStockistDistrictBackfillRows();
  const updates: Array<{ id: string; district: string | null }> = [];
  const summaries = new Map<string, { matched: number; unmatched: string[] }>();

  for (const row of rows) {
    const city = citySlugFromName(row.regionLabel);
    const district = city ? matchDistrict(row.address, city) : null;
    const summary = summaries.get(city ?? "unassigned") ?? {
      matched: 0,
      unmatched: [],
    };
    if (district) summary.matched += 1;
    else summary.unmatched.push(row.address);
    summaries.set(city ?? "unassigned", summary);
    if (district !== row.district) updates.push({ id: row.id, district });
  }

  for (const [city, summary] of [...summaries].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    console.log(
      `${city}: ${summary.matched} matched, ${summary.unmatched.length} unmatched`,
    );
    for (const address of summary.unmatched) console.log(`  - ${address}`);
  }

  const matched = [...summaries.values()].reduce(
    (sum, summary) => sum + summary.matched,
    0,
  );
  const rate = rows.length === 0 ? 100 : (matched / rows.length) * 100;
  console.log(
    `${rate.toFixed(1)}% matched; ${updates.length} updates (${APPLY ? "apply" : "dry run"})`,
  );
  if (rate < 90)
    throw new Error("District match rate is below the 90% stop threshold");
  if (APPLY) await updateStockistDistricts(updates);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
