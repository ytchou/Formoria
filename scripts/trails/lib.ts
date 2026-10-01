// Pure helpers for the trail shortlist and apply-picks scripts. No I/O, no
// Supabase, no Next — everything here is exercised directly by lib.test.ts.

import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export type TrailBriefSection = {
  key: string;
  title: string;
  query: string;
  subcategories: string[];
};

export type TrailBrief = {
  slug: string;
  sections: TrailBriefSection[];
};

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Validates a parsed `scripts/trails/briefs/<slug>.json`; throws on a bad shape. */
export function parseTrailBrief(raw: unknown): TrailBrief {
  if (!raw || typeof raw !== "object") throw new Error("Brief must be an object");
  const brief = raw as Record<string, unknown>;
  if (!isNonBlankString(brief.slug)) throw new Error("Brief needs a slug");
  if (!Array.isArray(brief.sections) || brief.sections.length === 0) {
    throw new Error("Brief needs at least one section");
  }

  const seen = new Set<string>();
  const sections = brief.sections.map((value, index) => {
    const section = (value ?? {}) as Record<string, unknown>;
    if (
      !isNonBlankString(section.key) ||
      !isNonBlankString(section.title) ||
      !isNonBlankString(section.query) ||
      !Array.isArray(section.subcategories) ||
      section.subcategories.length === 0 ||
      !section.subcategories.every(isNonBlankString)
    ) {
      throw new Error(
        `Brief section ${index} needs key, title, query and a non-empty subcategories[]`,
      );
    }
    if (seen.has(section.key)) {
      throw new Error(`Brief section key "${section.key}" is duplicated`);
    }
    seen.add(section.key);
    return {
      key: section.key,
      title: section.title,
      query: section.query,
      subcategories: section.subcategories as string[],
    };
  });

  return { slug: brief.slug, sections };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Columns `isTrailEligibleProduct` reads. Sources are a plain (not `!inner`)
 * embed so a product with no source row comes back and is refused here,
 * instead of silently disappearing from the result.
 */
export const TRAIL_ELIGIBILITY_SELECT =
  "id, key, visible, official_url, source_checked_at, subcategory, brands!inner(slug, status), curated_product_sources(state)";

export type TrailEligibilityRow = {
  visible: boolean | null;
  official_url: string | null;
  source_checked_at: string | null;
  subcategory: string | null;
  brands: { status: string | null } | null;
  curated_product_sources: readonly { state: string | null }[] | null;
};

/**
 * Product eligibility for a trail placement — the product half of the public
 * trail read (`getPublishedCuratedProductsForTrail`) without its selection
 * requirement, since a new trail has no placements yet.
 */
export function isTrailEligibleProduct(row: TrailEligibilityRow): boolean {
  return (
    row.visible === true &&
    isNonBlankString(row.official_url) &&
    row.source_checked_at !== null &&
    isNonBlankString(row.subcategory) &&
    row.brands?.status === "approved" &&
    (row.curated_product_sources ?? []).some(
      (source) => source.state === "active",
    )
  );
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export type ShortlistCandidate = {
  sectionKey: string;
  /** 1-based position in the retrieval (RRF) result. Lower is better. */
  rank: number;
  productId: string;
  productKey: string;
  brandSlug: string;
  brandName: string;
  name: string;
  subcategory: string;
  imageUrl: string | null;
  officialUrl: string | null;
  /** Optional prefill for the review sheet's note input. */
  note?: string;
};

export type ShortlistSection = TrailBriefSection & {
  candidates: ShortlistCandidate[];
};

/** The `candidates.json` written next to the review sheet. */
export type ShortlistCandidates = {
  trail: string;
  target: string;
  projectRef: string;
  generatedAt: string;
  sections: ShortlistSection[];
};

/**
 * D5: one product per brand within a section. Keeps the best-ranked product of
 * each brand per section; the same brand may appear in other sections. Output
 * is ordered by section first appearance, then rank.
 */
export function dedupeByBrandPerSection(
  candidates: readonly ShortlistCandidate[],
): ShortlistCandidate[] {
  const sectionOrder: string[] = [];
  const bySection = new Map<string, Map<string, ShortlistCandidate>>();

  for (const candidate of candidates) {
    let brands = bySection.get(candidate.sectionKey);
    if (!brands) {
      brands = new Map();
      bySection.set(candidate.sectionKey, brands);
      sectionOrder.push(candidate.sectionKey);
    }
    const kept = brands.get(candidate.brandSlug);
    if (!kept || candidate.rank < kept.rank) {
      brands.set(candidate.brandSlug, candidate);
    }
  }

  return sectionOrder.flatMap((key) =>
    [...bySection.get(key)!.values()].sort((a, b) => a.rank - b.rank),
  );
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

export type PickRow = {
  sectionKey: string;
  brandSlug: string;
  productKey: string;
  note: string;
  checked: boolean;
};

export type TrailPick = { brandSlug: string; productKey: string; note: string };

export type TrailPicks = {
  trail: string;
  sections: Record<string, TrailPick[]>;
};

/**
 * The `picks.json` shape. The review sheet's inline export builds the same
 * object in the browser; keep the two in step.
 */
export function toPicksJson(trail: string, rows: readonly PickRow[]): TrailPicks {
  const sections: Record<string, TrailPick[]> = {};
  for (const row of rows) {
    if (!row.checked) continue;
    (sections[row.sectionKey] ??= []).push({
      brandSlug: row.brandSlug,
      productKey: row.productKey,
      note: row.note.trim(),
    });
  }
  return { trail, sections };
}

// ---------------------------------------------------------------------------
// Apply picks
// ---------------------------------------------------------------------------

/** Mirrors NOTE_MAX_CHARS in scripts/checks/trail-frontmatter.mjs. */
const NOTE_MAX_CHARS = 20;

/** Brand slug and product key share the shape a `notes` key needs. */
const SLUG_SEGMENT = /^[a-z0-9-]+$/;

/**
 * Validates a parsed `picks.json` against the trail's MDX section keys and
 * returns it typed. Throws once, listing every problem. D5 holds per section
 * only: the same brand may appear in several sections.
 */
export function validatePicks(
  raw: unknown,
  sectionKeys: readonly string[],
): TrailPicks {
  if (!raw || typeof raw !== "object") throw new Error("Picks must be an object");
  const value = raw as Record<string, unknown>;
  if (!isNonBlankString(value.trail)) throw new Error("Picks need a trail slug");
  if (
    !value.sections ||
    typeof value.sections !== "object" ||
    Array.isArray(value.sections)
  ) {
    throw new Error("Picks need a sections object");
  }

  const knownKeys = new Set(sectionKeys);
  const problems: string[] = [];
  const sections: Record<string, TrailPick[]> = {};

  for (const [sectionKey, list] of Object.entries(
    value.sections as Record<string, unknown>,
  )) {
    if (!knownKeys.has(sectionKey)) {
      problems.push(`unknown section key "${sectionKey}"`);
      continue;
    }
    if (!Array.isArray(list)) {
      problems.push(`section "${sectionKey}" must be an array of picks`);
      continue;
    }

    const brands = new Set<string>();
    sections[sectionKey] = list.flatMap((item, index) => {
      const pick = (item ?? {}) as Record<string, unknown>;
      const where = `section "${sectionKey}" pick ${index}`;
      if (
        typeof pick.brandSlug !== "string" ||
        typeof pick.productKey !== "string" ||
        !SLUG_SEGMENT.test(pick.brandSlug) ||
        !SLUG_SEGMENT.test(pick.productKey)
      ) {
        problems.push(
          `${where}: brandSlug and productKey must be lowercase kebab-case`,
        );
        return [];
      }
      const note = typeof pick.note === "string" ? pick.note.trim() : "";
      if (note === "") {
        problems.push(`${where} (${pick.brandSlug}/${pick.productKey}): note is empty`);
      } else if ([...note].length > NOTE_MAX_CHARS) {
        problems.push(
          `${where} (${pick.brandSlug}/${pick.productKey}): note is ${[...note].length} characters; the limit is ${NOTE_MAX_CHARS}`,
        );
      }
      if (brands.has(pick.brandSlug)) {
        problems.push(
          `section "${sectionKey}" has brand "${pick.brandSlug}" more than once; one product per brand per section`,
        );
      }
      brands.add(pick.brandSlug);
      return [{ brandSlug: pick.brandSlug, productKey: pick.productKey, note }];
    });
  }

  if (problems.length > 0) {
    throw new Error(`Invalid picks:\n- ${problems.join("\n- ")}`);
  }
  return { trail: value.trail, sections };
}

export type ResolvedPick = TrailPick & { productId: string };

export type PlacementKey = { productId: string; sectionKey: string };

export type CurrentPlacement = PlacementKey & { position: number };

export type PlannedUpsert = ResolvedPick & { sectionKey: string; position: number };

export type PlacementPlan = { retire: PlacementKey[]; upsert: PlannedUpsert[] };

/**
 * Diffs the trail's active placements against the picks, which are the whole
 * desired state of the trail. An active placement the picks do not name is
 * retired, including every placement of a section the picks leave out.
 *
 * Retires come first: `upsertCuratedProductSelection` refuses a product while
 * another product of its brand is active in the same section, so a swapped-out
 * product must be retired before its same-brand replacement lands. Position is
 * the pick's index within its section.
 */
export function planPlacements(
  current: readonly CurrentPlacement[],
  picks: Readonly<Record<string, readonly ResolvedPick[]>>,
): PlacementPlan {
  const picked = new Set(
    Object.entries(picks).flatMap(([sectionKey, list]) =>
      list.map((pick) => `${sectionKey}\u0000${pick.productId}`),
    ),
  );

  const retire = current
    .filter((row) => !picked.has(`${row.sectionKey}\u0000${row.productId}`))
    .map(({ productId, sectionKey }) => ({ productId, sectionKey }));

  const upsert = Object.entries(picks).flatMap(([sectionKey, list]) =>
    list.map((pick, position) => ({ ...pick, sectionKey, position })),
  );

  return { retire, upsert };
}

/** `sections[].notes` for one section: the picks keyed `brandSlug/productKey`. */
export function notesForSection(
  picks: readonly TrailPick[],
): Record<string, string> {
  return Object.fromEntries(
    picks.map((pick) => [`${pick.brandSlug}/${pick.productKey}`, pick.note]),
  );
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function withoutNotes(data: Record<string, unknown>): string {
  const sections = Array.isArray(data.sections)
    ? data.sections.map((section) => {
        if (!section || typeof section !== "object") return section;
        const copy = { ...(section as Record<string, unknown>) };
        delete copy.notes;
        return copy;
      })
    : data.sections;
  return JSON.stringify({ ...data, sections });
}

/**
 * Rewrites the `notes` block of each section named in `notesBySection` and
 * leaves every other byte of the MDX untouched — the body and every other
 * frontmatter line stay verbatim. An empty record removes the section's notes;
 * a section left out of the map keeps whatever notes it has.
 *
 * This edits frontmatter lines rather than re-dumping the YAML: a parse/dump
 * round trip turns `publishedAt: 2026-08-25` into an ISO timestamp and
 * reflows long strings. gray-matter then re-parses the result and proves that
 * only the notes changed. Supports the block layout the trail files use
 * (`sections:` followed by `- key:` items); anything else throws.
 */
export function rewriteTrailNotes(
  source: string,
  notesBySection: Readonly<Record<string, Readonly<Record<string, string>>>>,
): string {
  if (source.includes("\r")) throw new Error("CRLF trail files are not supported");
  if (!source.startsWith("---\n")) throw new Error("Trail MDX has no frontmatter");
  const close = source.indexOf("\n---", 3);
  if (close < 0) throw new Error("Trail MDX frontmatter is not closed");

  const head = source.slice(0, 4);
  const frontmatter = source.slice(4, close + 1);
  const rest = source.slice(close + 1);
  const original = matter(source, {}).data as Record<string, unknown>;
  const parsedSections = Array.isArray(original.sections)
    ? (original.sections as Record<string, unknown>[])
    : [];

  const lines = frontmatter.split("\n");
  const sectionsLine = lines.findIndex((line) => /^sections:\s*$/.test(line));
  if (sectionsLine < 0) throw new Error("Trail frontmatter has no block `sections:`");

  let blockEnd = sectionsLine + 1;
  while (
    blockEnd < lines.length &&
    (lines[blockEnd]!.trim() === "" ||
      /^\s/.test(lines[blockEnd]!) ||
      lines[blockEnd]!.startsWith("- "))
  ) {
    blockEnd += 1;
  }

  const firstItem = lines.findIndex(
    (line, index) => index > sectionsLine && index < blockEnd && /^\s*- /.test(line),
  );
  if (firstItem < 0) throw new Error("Trail `sections:` has no items");
  const itemIndent = indentOf(lines[firstItem]!);
  const contentPad = " ".repeat(itemIndent + 2);
  const starts: number[] = [];
  for (let index = sectionsLine + 1; index < blockEnd; index += 1) {
    const line = lines[index]!;
    if (line.trim() === "") continue;
    if (indentOf(line) === itemIndent && line.trimStart().startsWith("- ")) {
      starts.push(index);
    } else if (starts.length === 0 || indentOf(line) < itemIndent + 2) {
      throw new Error(`Unsupported trail sections layout at frontmatter line ${index + 1}`);
    }
  }
  if (starts.length !== parsedSections.length) {
    throw new Error("Trail sections layout does not match the parsed frontmatter");
  }

  const output = lines.slice(0, sectionsLine + 1);
  starts.forEach((start, item) => {
    const end = starts[item + 1] ?? blockEnd;
    let itemLines = lines.slice(start, end);
    const key = parsedSections[item]?.key;
    const desired = typeof key === "string" ? notesBySection[key] : undefined;

    if (desired !== undefined) {
      if (/^\s*- notes:/.test(itemLines[0]!)) {
        throw new Error(`Section "${String(key)}" starts with notes; move them below key`);
      }
      const notesAt = itemLines.findIndex((line) =>
        line.startsWith(`${contentPad}notes:`),
      );
      if (notesAt >= 0) {
        let notesEnd = notesAt + 1;
        while (
          notesEnd < itemLines.length &&
          (itemLines[notesEnd]!.trim() === "" ||
            indentOf(itemLines[notesEnd]!) > itemIndent + 2)
        ) {
          notesEnd += 1;
        }
        // Blank lines between the notes block and the next key belong to the
        // surrounding layout, not to the notes.
        while (notesEnd > notesAt + 1 && itemLines[notesEnd - 1]!.trim() === "") {
          notesEnd -= 1;
        }
        itemLines = [...itemLines.slice(0, notesAt), ...itemLines.slice(notesEnd)];
      }

      const entries = Object.entries(desired);
      if (entries.length > 0) {
        let insertAt = itemLines.length;
        while (insertAt > 1 && itemLines[insertAt - 1]!.trim() === "") insertAt -= 1;
        itemLines = [
          ...itemLines.slice(0, insertAt),
          `${contentPad}notes:`,
          ...entries.map(
            ([noteKey, note]) =>
              `${contentPad}  ${JSON.stringify(noteKey)}: ${JSON.stringify(note)}`,
          ),
          ...itemLines.slice(insertAt),
        ];
      }
    }
    output.push(...itemLines);
  });
  output.push(...lines.slice(blockEnd));

  const result = `${head}${output.join("\n")}${rest}`;

  // Prove the edit: everything but the notes parses identically, and each
  // rewritten section carries exactly the requested notes.
  const rewritten = matter(result, {}).data as Record<string, unknown>;
  if (withoutNotes(rewritten) !== withoutNotes(original)) {
    throw new Error("Notes rewrite changed frontmatter outside sections[].notes");
  }
  const rewrittenSections = (rewritten.sections ?? []) as Record<string, unknown>[];
  for (const section of rewrittenSections) {
    const desired =
      typeof section.key === "string" ? notesBySection[section.key] : undefined;
    if (desired === undefined) continue;
    const actual = (section.notes ?? {}) as Record<string, unknown>;
    if (JSON.stringify(actual) !== JSON.stringify(desired)) {
      throw new Error(`Notes rewrite for section "${String(section.key)}" did not round-trip`);
    }
  }

  return result;
}
