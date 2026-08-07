/**
 * One-off: merge the 2026 Creative Expo brand-URL research CSVs into the
 * canonical exhibitor ledger.
 *
 * This script MUTATES the existing ledger. It never rebuilds one from the CSVs,
 * and that distinction is the whole safety story: 24 K-zone booths (10 of them
 * linked to real directory brands) appear in the ledger and not in the CSVs. A
 * rebuild would silently drop them, and the next `pnpm seed-events` would then
 * DELETE those rows and their `event_brands` links, because
 * `planEventExhibitorSeed` prunes anything absent from the plan.
 *
 * Merge policy, keyed on booth number:
 *   - booth in both  -> CSV is authoritative for `websiteUrl` and for adding a
 *                       brand link. It NEVER renames a row and NEVER drops a
 *                       link; either would abort the run.
 *   - ledger only    -> untouched, kept.
 *   - CSV only       -> appended as `included_unlinked`.
 *
 * It also patches `block-geometry.json`, because
 * `src/lib/events/creative-expo-block-geometry.test.ts` asserts every ledger
 * booth is placed in some block. The new booths already have rects; they just
 * carry an empty `booths[]` today, as "printed but uncatalogued" ghosts.
 *
 * Idempotent: a second run over its own output must be a byte-level no-op.
 *
 *   pnpm exec tsx scripts/merge-expo-exhibitor-csv.ts            # dry run
 *   pnpm exec tsx scripts/merge-expo-exhibitor-csv.ts --write
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { parseExhibitorLedger, exhibitorCoverage } from "./seed-events";

const ROOT = path.resolve(__dirname, "..");
const LEDGER_PATH = path.join(
  ROOT,
  "content/events/2026-taiwan-creative-expo.exhibitors.json",
);
const GEOMETRY_PATH = path.join(
  ROOT,
  "content/events/2026-taiwan-creative-expo.block-geometry.json",
);
const CSV_PATHS = [
  path.join(ROOT, "scripts/seeds/2026-cet-k1-k3-brands-v3.csv"),
  path.join(ROOT, "scripts/seeds/2026-cet-s-zone-brands.csv"),
];

/** Import date. Only the five new rows carry it; see `verifiedAt` below. */
const IMPORT_DATE = "2026-08-08";
const LISTING_URL = "https://creativexpo.tw/zh-TW/exhibitor_list";
const K_ZONE_AREA = "文創品牌展區";
const K_ZONE_AREA_EN = "Cultural & Creative Brands";
const K_ZONE_CATEGORY = "cultural_creative";
const ZONE_RANK: Record<string, number> = { K1: 0, K2: 1, K3: 2, S: 3, J2: 4 };

/**
 * The five booths the CSV adds. Names are transcribed by hand rather than
 * split by a heuristic: five strings do not justify a regex whose failures are
 * silent, and all five happen to be Latin-only, so `name === nameEn`.
 */
const NEW_ROW_NAMES: Record<string, { name: string; nameEn: string }> = {
  "K2-042": { name: "BWILD ISAN", nameEn: "BWILD ISAN" },
  "K2-055": { name: "SARNSARD", nameEn: "SARNSARD" },
  "K3-002": { name: "Design Busan", nameEn: "Design Busan" },
  "K3-003": { name: "MACO", nameEn: "MACO" },
  "K3-009": { name: "SEDIA", nameEn: "SEDIA" },
};

const URL_PROVENANCE =
  " Official website URLs added 2026-08-08 from a separate link-research pass " +
  "(scripts/seeds/2026-cet-*.csv); the listing itself does not publish them.";

type CsvRow = {
  booth_number: string;
  brand_name: string;
  brand_url: string;
  is_on_formoria: string;
  formoria_url: string;
};

type Exhibitor = Record<string, unknown> & {
  sourceKey: string;
  zone: string;
  booth: string | null;
  sortOrder: number;
  outcome: string;
  brandSlug?: string | null;
  websiteUrl?: string | null;
  verificationEvidence: { basis: string } & Record<string, unknown>;
};

type Ledger = {
  reportTimeEvidence: {
    checkpoint: Record<string, number>;
    notes?: string;
  } & Record<string, unknown>;
  exhibitors: Exhibitor[];
} & Record<string, unknown>;

type GeometryBlock = { block: string; booths: string[] } & Record<
  string,
  unknown
>;

/**
 * RFC4180 parser. Deliberately not `split(",")`: ten K-zone rows carry quoted
 * fields with embedded commas ("林源美百年香店 LIN,YUAN-MAI Incense shop", eight
 * Japanese "Co., Ltd." names), and one of them is a row that gains a brand link.
 * A naive split corrupts those rows and loses that link.
 */
function parseCsv(text: string): CsvRow[] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];
    if (quoted) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Swallow the LF of a CRLF pair so it does not open an empty record.
      if (char === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!header) throw new Error("empty CSV");
  return body.map((cells, index) => {
    if (cells.length !== header.length) {
      throw new Error(
        `CSV row ${index + 2} has ${cells.length} fields, expected ${header.length}`,
      );
    }
    return Object.fromEntries(
      header.map((key, i) => [key.trim(), (cells[i] ?? "").trim()]),
    ) as CsvRow;
  });
}

/** `https://formoria.com/brands/woky` -> `woky`; empty when not listed. */
function slugFromFormoriaUrl(row: CsvRow): string | null {
  if (row.is_on_formoria !== "是") return null;
  const url = row.formoria_url.trim();
  if (!url) return null;
  const slug = url.replace(/\/+$/, "").split("/").pop() ?? "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(
      `booth ${row.booth_number}: unusable formoria_url "${url}"`,
    );
  }
  return slug;
}

/**
 * The two files this script writes are formatted by different owners, and
 * matching each one matters more than being internally consistent.
 *
 * The ledger is Prettier-formatted in the repo, so it goes back through
 * Prettier — `JSON.stringify(…, 2)` explodes every short array onto its own
 * lines where Prettier keeps them inline, which would leave `format:check` red
 * and make a re-run diff against its own output.
 *
 * The geometry file is NOT Prettier-formatted and never has been: it is
 * generated by `scripts/extract-expo-block-geometry.mjs` with plain
 * `JSON.stringify`. Reformatting it here would turn a five-booth change into a
 * 1,100-line diff and put this script's output at odds with its generator's.
 */
async function serializeLedger(
  filePath: string,
  value: unknown,
): Promise<string> {
  const config = await resolveConfig(filePath);
  return format(JSON.stringify(value), {
    ...config,
    filepath: filePath,
    parser: "json",
  });
}

function serializeGeometry(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");

  const ledgerText = readFileSync(LEDGER_PATH, "utf-8");
  const ledger = JSON.parse(ledgerText) as Ledger;
  // Validate what we are about to mutate. A ledger that does not parse today is
  // not a ledger this script should be rewriting.
  parseExhibitorLedger(path.basename(LEDGER_PATH), ledger);

  const csvRows = CSV_PATHS.flatMap((file) =>
    parseCsv(readFileSync(file, "utf-8")),
  );
  const seenBooths = new Set<string>();
  for (const row of csvRows) {
    if (seenBooths.has(row.booth_number)) {
      throw new Error(`duplicate CSV booth ${row.booth_number}`);
    }
    seenBooths.add(row.booth_number);
  }

  const byBooth = new Map<string, Exhibitor>();
  for (const exhibitor of ledger.exhibitors) {
    if (!exhibitor.booth) continue;
    if (byBooth.has(exhibitor.booth)) {
      throw new Error(`duplicate ledger booth ${exhibitor.booth}`);
    }
    byBooth.set(exhibitor.booth, exhibitor);
  }

  const before = {
    sourceKeys: new Set(ledger.exhibitors.map((e) => e.sourceKey)),
    links: new Map(
      ledger.exhibitors
        .filter((e) => e.brandSlug)
        .map((e) => [e.sourceKey, e.brandSlug as string]),
    ),
  };

  let urlUpdates = 0;
  let newLinks = 0;
  let outcomeFlips = 0;
  const inserted: Exhibitor[] = [];

  for (const row of csvRows) {
    const booth = row.booth_number;
    const slug = slugFromFormoriaUrl(row);
    const websiteUrl = row.brand_url.trim() || null;
    const existing = byBooth.get(booth);

    if (existing) {
      if (existing.websiteUrl !== websiteUrl) {
        existing.websiteUrl = websiteUrl;
        urlUpdates += 1;
      }
      const current = (existing.brandSlug as string | null) ?? null;
      if (slug && !current) {
        existing.brandSlug = slug;
        existing.outcome = "matched_existing";
        newLinks += 1;
      } else if (slug && current !== slug) {
        throw new Error(
          `booth ${booth}: CSV would relink ${current} -> ${slug}; not covered by the merge policy`,
        );
      } else if (!slug && current) {
        throw new Error(
          `booth ${booth}: CSV would drop the existing link to ${current}`,
        );
      }
      if (!slug && existing.outcome === "out_of_scope") {
        existing.outcome = "included_unlinked";
        outcomeFlips += 1;
      }
      // Only rows sourced from the official listing need the clause: it exists
      // to stop the ledger citing that listing as the basis for a URL the
      // listing never carried. Rows this script inserted already date the
      // research pass in their own basis, and appending to them here would make
      // a re-run non-idempotent.
      const isImported = existing.sourceKey.startsWith("creative-expo-booth:");
      if (
        !isImported &&
        !existing.verificationEvidence.basis.includes(URL_PROVENANCE.trim())
      ) {
        existing.verificationEvidence.basis += URL_PROVENANCE;
      }
      continue;
    }

    // A booth-derived key cannot collide with `creative-expo:<numeric id>`, and
    // the booth number is the only stable identifier the CSV carries.
    const sourceKey = `creative-expo-booth:${booth}`;
    if (before.sourceKeys.has(sourceKey)) {
      throw new Error(`booth ${booth}: source key ${sourceKey} already exists`);
    }
    const names = NEW_ROW_NAMES[booth];
    if (!names) {
      throw new Error(
        `booth ${booth} is new but has no reviewed name entry; add it to NEW_ROW_NAMES`,
      );
    }
    if (slug) {
      throw new Error(
        `booth ${booth}: a brand-new row cannot arrive already linked to ${slug}`,
      );
    }
    const zone = booth.split("-")[0] ?? "";
    if (!["K1", "K2", "K3"].includes(zone)) {
      throw new Error(`booth ${booth}: unexpected zone ${zone} for a new row`);
    }
    const row_: Exhibitor = {
      sourceKey,
      name: names.name,
      nameEn: names.nameEn,
      booth,
      area: K_ZONE_AREA,
      areaEn: K_ZONE_AREA_EN,
      zone,
      eventCategory: K_ZONE_CATEGORY,
      sourceUrl: LISTING_URL,
      websiteUrl,
      verifiedAt: IMPORT_DATE,
      sortOrder: 0, // replaced by the global renumber below
      reviewPriority: "medium",
      verificationEvidence: {
        sourceUrl: LISTING_URL,
        detailUrl: null,
        retrievedAt: IMPORT_DATE,
        basis:
          "Booth-roster reconciliation against the printed 2026 Creative Expo floor plan; " +
          "this stand is on the plan but absent from the 2026-08-06 listing snapshot.",
      },
      outcome: "included_unlinked",
    };
    ledger.exhibitors.push(row_);
    byBooth.set(booth, row_);
    inserted.push(row_);
  }

  // Global renumber. `sortOrder` must be unique (the validator rejects
  // duplicates) and drives display order, so appending the new rows at the end
  // would file them after S and J2. This ordering reproduces the pre-merge
  // order exactly for every pre-existing row.
  ledger.exhibitors.sort((left, right) => {
    const zone = (ZONE_RANK[left.zone] ?? 99) - (ZONE_RANK[right.zone] ?? 99);
    if (zone !== 0) return zone;
    const booth = (left.booth ?? "").localeCompare(right.booth ?? "", "en");
    if (booth !== 0) return booth;
    return left.sourceKey.localeCompare(right.sourceKey, "en");
  });
  ledger.exhibitors.forEach((exhibitor, index) => {
    exhibitor.sortOrder = index;
  });

  const coverage = exhibitorCoverage(
    ledger.exhibitors as never[],
  ) as unknown as { byZone: Record<string, number> };
  for (const zone of Object.keys(ledger.reportTimeEvidence.checkpoint)) {
    ledger.reportTimeEvidence.checkpoint[zone] = coverage.byZone[zone] ?? 0;
  }
  // The old note claimed the counts came purely from the category-filtered
  // listing. After this merge K2/K3 include booths the listing never carried.
  ledger.reportTimeEvidence.notes =
    "Counts are the reconciled booth roster, not application constants: they combine the " +
    "official category-filtered listing retrieved 2026-08-06 with booths printed on the " +
    "floor plan but absent from that snapshot.";

  // Geometry: every ledger booth must be placed in a block, or
  // creative-expo-block-geometry.test.ts fails.
  const geometryText = readFileSync(GEOMETRY_PATH, "utf-8");
  const geometry = JSON.parse(geometryText) as { blocks: GeometryBlock[] };
  const blockOf = (booth: string) => {
    const match = /^(K1|K2|K3|S)-(\d+)(?:-(\d+))?$/.exec(booth);
    return match ? `${match[1]}-${match[2]}` : null;
  };
  let geometryAdds = 0;
  for (const exhibitor of ledger.exhibitors) {
    if (!exhibitor.booth) continue;
    const blockId = blockOf(exhibitor.booth);
    if (!blockId) continue; // J2 lives off this plan
    const block = geometry.blocks.find(
      (candidate) => candidate.block === blockId,
    );
    if (!block) {
      throw new Error(
        `booth ${exhibitor.booth} has no rect for block ${blockId} in block-geometry.json`,
      );
    }
    if (!block.booths.includes(exhibitor.booth)) {
      block.booths.push(exhibitor.booth);
      block.booths.sort((a, b) => a.localeCompare(b, "en"));
      geometryAdds += 1;
    }
  }

  // --- self-validation -----------------------------------------------------
  parseExhibitorLedger(path.basename(LEDGER_PATH), ledger);

  const afterKeys = new Set(ledger.exhibitors.map((e) => e.sourceKey));
  for (const key of before.sourceKeys) {
    if (!afterKeys.has(key)) throw new Error(`row disappeared: ${key}`);
  }
  const afterLinks = new Map(
    ledger.exhibitors
      .filter((e) => e.brandSlug)
      .map((e) => [e.sourceKey, e.brandSlug as string]),
  );
  for (const [key, slug] of before.links) {
    if (afterLinks.get(key) !== slug) {
      throw new Error(`link changed or lost on ${key}: ${slug}`);
    }
  }
  const slugs = [...afterLinks.values()];
  if (new Set(slugs).size !== slugs.length) {
    throw new Error("duplicate brandSlug after merge");
  }
  const placed = new Set(geometry.blocks.flatMap((block) => block.booths));
  const unplaced = ledger.exhibitors
    .map((e) => e.booth)
    .filter((booth): booth is string => Boolean(booth && blockOf(booth)))
    .filter((booth) => !placed.has(booth));
  if (unplaced.length > 0) {
    throw new Error(`booths missing geometry: ${unplaced.join(", ")}`);
  }

  const persisted = ledger.exhibitors.filter(
    (e) =>
      e.outcome === "matched_existing" || e.outcome === "included_unlinked",
  ).length;

  console.log(
    [
      `rows            ${before.sourceKeys.size} -> ${ledger.exhibitors.length}`,
      `persisted       ${persisted}`,
      `links           ${before.links.size} -> ${afterLinks.size}`,
      `websiteUrl set  ${urlUpdates}`,
      `new links       ${newLinks}`,
      `outcome flips   ${outcomeFlips}  (out_of_scope -> included_unlinked)`,
      `inserted rows   ${inserted.length}  ${inserted.map((r) => r.booth).join(", ")}`,
      `geometry adds   ${geometryAdds}`,
      `checkpoint      ${JSON.stringify(ledger.reportTimeEvidence.checkpoint)}`,
    ].join("\n"),
  );

  const nextLedger = await serializeLedger(LEDGER_PATH, ledger);
  const nextGeometry = serializeGeometry(geometry);
  if (!write) {
    console.log(
      `\ndry run — pass --write to update the ledger and block geometry` +
        `\nledger   ${nextLedger === ledgerText ? "unchanged" : "would change"}` +
        `\ngeometry ${nextGeometry === geometryText ? "unchanged" : "would change"}`,
    );
    return;
  }
  writeFileSync(LEDGER_PATH, nextLedger);
  writeFileSync(GEOMETRY_PATH, nextGeometry);
  console.log("\nwritten.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
