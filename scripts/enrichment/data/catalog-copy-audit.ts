/**
 * @formoria-script
 * purpose: Read-only audit of catalog copy and data hygiene (DEV-1989) that prints the regeneration commands for what it finds.
 * class: validator
 * invoke: pnpm exec tsx scripts/enrichment/data/catalog-copy-audit.ts
 * target: staging-default
 * safety: read-only
 * owner: engineering
 * notes: --json=<path> writes the full report; --cohort-out=<dir> writes refresh cohort files for the printed curation:rerun commands.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { splitLede } from "@/lib/brands/split-lede";
import { subcategoryBySlug } from "@/lib/taxonomy/ontology";

import { fetchAllRows } from "../products/curated-products/shared";

/**
 * Catalog copy audit (DEV-1989: CP2-36..38, BD2-05/07/16/26/27).
 *
 *   pnpm exec tsx scripts/enrichment/data/catalog-copy-audit.ts
 *   …--json=<path>          full report as JSON
 *   …--cohort-out=<dir>     write refresh cohort files the printed commands use
 *   …--target=production    defaults to staging; see scripts/shared/target.ts
 *
 * READ-ONLY. Nothing here writes to the database or calls a model. The owner
 * decides from this report whether and when to regenerate; the closing block
 * prints the existing commands that would do it, scoped to the rows found.
 *
 * Scope: approved brands, and visible curated products of approved brands.
 */

// ---------------------------------------------------------------------------
// Row shapes (snake_case, exactly as read)
// ---------------------------------------------------------------------------

export type AuditBrandRow = {
  id: string;
  slug: string;
  category: string | null;
  /** The zh card/meta blurb. */
  blurb: string | null;
  description: string | null;
  description_en: string | null;
};

export type AuditProductRow = {
  id: string;
  brand_id: string;
  name_zh: string;
  name_en: string | null;
  product_description_zh: string;
  product_description_en: string | null;
  category: string;
  subcategory: string | null;
  proposed_by: string;
};

export type AuditImageRow = {
  brand_id: string;
  width: number | null;
};

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

/** BD2-07: a hero source narrower than this is upscaled on a retina desktop. */
export const LOW_RES_WIDTH = 1000;

/** BD2-16: the EN story should stay under about this many characters. */
export const EN_DESCRIPTION_SOFT_MAX = 600;

const EXCERPT_RADIUS = 12;

/** U+81FA, the variant tai character. Escaped so this file holds none. */
const TAI_VARIANT = "\u81fa";

/**
 * CP2-36 banned constructions. `key` is ASCII for the JSON report; `label`
 * is what a reader recognises.
 *
 * The 以 heuristic: 「以」 that is not part of a common compound, followed by
 * 1-12 non-punctuation characters, then a making/being verb — the shape of
 * 「以植鞣牛皮製作」「以陶土為主」「以手工方式縫製」.
 *  - Lookbehind skips 可以/所以/難以/得以/予以/加以/用以/足以/藉以.
 *  - Lookahead skips 以上/以下/以及/以來/以前/以後/以外/以內/以便/以免/以致.
 *  - The verb list is deliberately short; a 以 clause without one of these
 *    verbs is missed rather than guessed at. Expect a few false negatives,
 *    near-zero false positives.
 */
export const BANNED_PATTERNS: readonly {
  key: string;
  label: string;
  pattern: RegExp;
}[] = [
  {
    key: "yi-construction",
    label: "以…(製作/為/打造…)",
    pattern:
      /(?<![可所難得予加用足藉])以(?![上下及來前後外內便免致])[^，。、；：！？「」\s]{1,12}?(?:製作|製成|打造|縫製|手工|設計|創作|開發|推出|呈現|發想|為)/gu,
  },
  { key: "dazao", label: "打造", pattern: /打造/gu },
  { key: "jiehe", label: "結合", pattern: /結合/gu },
  { key: "rongru", label: "融入", pattern: /融入/gu },
  { key: "ronghe", label: "融合", pattern: /融合/gu },
  {
    key: "cong-chufa",
    label: "從…出發",
    pattern: /從[^，。；！？]{1,15}?出發/gu,
  },
  { key: "cong-dao", label: "從…到…", pattern: /從[^，。；！？]{1,15}?到/gu },
  { key: "tai-variant", label: "\\u81fa", pattern: new RegExp(TAI_VARIANT, "gu") },
];

/** Full-width Latin letters and digits (BD-06 validator). */
const FULL_WIDTH_ALNUM = /[０-９Ａ-Ｚａ-ｚ]/u;

export function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(text.length, index + length + EXCERPT_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`.replace(
    /\n/g,
    " ",
  );
}

export type TermHit = { key: string; label: string; excerpt: string };

/** Every banned-construction hit in `text`, in pattern order. */
export function findBannedTerms(text: string): TermHit[] {
  const hits: TermHit[] = [];
  for (const { key, label, pattern } of BANNED_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      hits.push({
        key,
        label,
        excerpt: excerptAround(text, match.index ?? 0, match[0].length),
      });
    }
  }
  return hits;
}

function firstFullWidthExcerpt(text: string | null): string | null {
  if (!text) return null;
  const match = FULL_WIDTH_ALNUM.exec(text);
  return match ? excerptAround(text, match.index, 1) : null;
}

// ---------------------------------------------------------------------------
// Report sections
// ---------------------------------------------------------------------------

export type BannedTermsSection = {
  /** Brands with at least one hit, per term key. */
  brandsPerTerm: Record<string, number>;
  /** Total hits, per term key. */
  hitsPerTerm: Record<string, number>;
  brands: {
    slug: string;
    id: string;
    hits: (TermHit & { field: "blurb" | "description" })[];
  }[];
};

export function auditBannedTerms(
  brands: readonly AuditBrandRow[],
): BannedTermsSection {
  const brandsPerTerm: Record<string, number> = {};
  const hitsPerTerm: Record<string, number> = {};
  for (const { key } of BANNED_PATTERNS) {
    brandsPerTerm[key] = 0;
    hitsPerTerm[key] = 0;
  }
  const flagged: BannedTermsSection["brands"] = [];

  for (const brand of brands) {
    const hits = [
      ...findBannedTerms(brand.blurb ?? "").map((hit) => ({
        ...hit,
        field: "blurb" as const,
      })),
      ...findBannedTerms(brand.description ?? "").map((hit) => ({
        ...hit,
        field: "description" as const,
      })),
    ];
    if (hits.length === 0) continue;
    for (const hit of hits) hitsPerTerm[hit.key] += 1;
    for (const key of new Set(hits.map((hit) => hit.key))) brandsPerTerm[key] += 1;
    flagged.push({ slug: brand.slug, id: brand.id, hits });
  }

  return { brandsPerTerm, hitsPerTerm, brands: flagged };
}

type ProductRef = { brandSlug: string; id: string; nameZh: string };

function productRef(
  product: AuditProductRow,
  slugById: ReadonlyMap<string, string>,
): ProductRef {
  return {
    brandSlug: slugById.get(product.brand_id) ?? "?",
    id: product.id,
    nameZh: product.name_zh,
  };
}

function isBlank(value: string | null): boolean {
  return !value || value.trim().length === 0;
}

export type MissingEnglishSection = {
  missingDescriptionEn: number;
  missingNameEn: number;
  missingBoth: number;
  /** Rows with no EN description; `nameEnMissing` marks the ones with no EN name either. */
  products: (ProductRef & { nameEnMissing: boolean })[];
  /** zh product notes that carry the variant tai character. */
  taiVariantNotes: (ProductRef & { excerpt: string; generated: boolean })[];
};

export function auditMissingEnglish(
  products: readonly AuditProductRow[],
  slugById: ReadonlyMap<string, string>,
): MissingEnglishSection {
  const section: MissingEnglishSection = {
    missingDescriptionEn: 0,
    missingNameEn: 0,
    missingBoth: 0,
    products: [],
    taiVariantNotes: [],
  };
  for (const product of products) {
    const noDescription = isBlank(product.product_description_en);
    const noName = isBlank(product.name_en);
    if (noDescription) section.missingDescriptionEn += 1;
    if (noName) section.missingNameEn += 1;
    if (noDescription && noName) section.missingBoth += 1;
    if (noDescription) {
      section.products.push({ ...productRef(product, slugById), nameEnMissing: noName });
    }
    const taiIndex = product.product_description_zh.indexOf(TAI_VARIANT);
    if (taiIndex >= 0) {
      section.taiVariantNotes.push({
        ...productRef(product, slugById),
        excerpt: excerptAround(product.product_description_zh, taiIndex, 1),
        generated: product.proposed_by === "generated",
      });
    }
  }
  return section;
}

export type DuplicateDescriptionGroup = {
  brandSlug: string;
  brandId: string;
  excerpt: string;
  members: { id: string; nameZh: string; generated: boolean }[];
};

/** BD2-27: identical zh notes within one brand. Whitespace-trimmed, otherwise exact. */
export function auditDuplicateDescriptions(
  products: readonly AuditProductRow[],
  slugById: ReadonlyMap<string, string>,
): DuplicateDescriptionGroup[] {
  const groups = new Map<string, DuplicateDescriptionGroup>();
  for (const product of products) {
    const text = product.product_description_zh.trim();
    if (!text) continue;
    const key = `${product.brand_id}\u0000${text}`;
    const group = groups.get(key) ?? {
      brandSlug: slugById.get(product.brand_id) ?? "?",
      brandId: product.brand_id,
      excerpt: excerptAround(text, 0, 0),
      members: [],
    };
    group.members.push({
      id: product.id,
      nameZh: product.name_zh,
      generated: product.proposed_by === "generated",
    });
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.members.length > 1);
}

export type ImageResolutionSection = {
  threshold: number;
  lowRes: { slug: string; id: string; maxWidth: number }[];
  /** Active images exist but none has a recorded width. */
  unknownWidth: { slug: string; id: string }[];
  noActiveImages: { slug: string; id: string }[];
};

/** BD2-07: the widest active image per brand, against `LOW_RES_WIDTH`. */
export function auditImageResolution(
  brands: readonly AuditBrandRow[],
  images: readonly AuditImageRow[],
): ImageResolutionSection {
  const counts = new Map<string, number>();
  const maxWidth = new Map<string, number>();
  for (const image of images) {
    counts.set(image.brand_id, (counts.get(image.brand_id) ?? 0) + 1);
    if (image.width === null) continue;
    maxWidth.set(
      image.brand_id,
      Math.max(maxWidth.get(image.brand_id) ?? 0, image.width),
    );
  }

  const section: ImageResolutionSection = {
    threshold: LOW_RES_WIDTH,
    lowRes: [],
    unknownWidth: [],
    noActiveImages: [],
  };
  for (const brand of brands) {
    const ref = { slug: brand.slug, id: brand.id };
    if (!counts.has(brand.id)) section.noActiveImages.push(ref);
    else if (!maxWidth.has(brand.id)) section.unknownWidth.push(ref);
    else if (maxWidth.get(brand.id)! < LOW_RES_WIDTH) {
      section.lowRes.push({ ...ref, maxWidth: maxWidth.get(brand.id)! });
    }
  }
  section.lowRes.sort((a, b) => a.maxWidth - b.maxWidth);
  return section;
}

export type FullWidthHit = {
  kind: "brand" | "product";
  brandSlug: string;
  id: string;
  field: string;
  excerpt: string;
};

export type TaxonomySection = {
  /** The L2's own L1 differs from the product's stored `category`. */
  productCategoryMismatch: (ProductRef & {
    subcategory: string;
    subcategoryL1: string;
    productCategory: string;
  })[];
  /** The L2's L1 differs from the brand's category (may be legitimate — review). */
  brandCategoryMismatch: (ProductRef & {
    subcategory: string;
    subcategoryL1: string;
    brandCategory: string;
  })[];
  unknownSubcategory: (ProductRef & { subcategory: string })[];
};

/** BD2-26 part 1: full-width letters/digits in brand stories and product copy. */
export function auditFullWidth(
  brands: readonly AuditBrandRow[],
  products: readonly AuditProductRow[],
  slugById: ReadonlyMap<string, string>,
): FullWidthHit[] {
  const hits: FullWidthHit[] = [];
  for (const brand of brands) {
    for (const field of ["description", "description_en"] as const) {
      const excerpt = firstFullWidthExcerpt(brand[field]);
      if (excerpt) {
        hits.push({ kind: "brand", brandSlug: brand.slug, id: brand.id, field, excerpt });
      }
    }
  }
  for (const product of products) {
    for (const field of [
      "name_zh",
      "name_en",
      "product_description_zh",
      "product_description_en",
    ] as const) {
      const excerpt = firstFullWidthExcerpt(product[field]);
      if (excerpt) {
        hits.push({
          kind: "product",
          brandSlug: slugById.get(product.brand_id) ?? "?",
          id: product.id,
          field,
          excerpt,
        });
      }
    }
  }
  return hits;
}

/** BD2-26 part 2: a product L2 that belongs to another L1. */
export function auditTaxonomy(
  products: readonly AuditProductRow[],
  brandsById: ReadonlyMap<string, AuditBrandRow>,
): TaxonomySection {
  const section: TaxonomySection = {
    productCategoryMismatch: [],
    brandCategoryMismatch: [],
    unknownSubcategory: [],
  };
  for (const product of products) {
    if (!product.subcategory) continue;
    const brand = brandsById.get(product.brand_id);
    const ref: ProductRef = {
      brandSlug: brand?.slug ?? "?",
      id: product.id,
      nameZh: product.name_zh,
    };
    const node = subcategoryBySlug(product.subcategory);
    if (!node) {
      section.unknownSubcategory.push({ ...ref, subcategory: product.subcategory });
      continue;
    }
    if (node.category !== product.category) {
      section.productCategoryMismatch.push({
        ...ref,
        subcategory: node.slug,
        subcategoryL1: node.category,
        productCategory: product.category,
      });
    }
    if (brand?.category && node.category !== brand.category) {
      section.brandCategoryMismatch.push({
        ...ref,
        subcategory: node.slug,
        subcategoryL1: node.category,
        brandCategory: brand.category,
      });
    }
  }
  return section;
}

export type ParagraphingSection = {
  zhSingleParagraph: { slug: string; id: string }[];
  enSingleParagraph: { slug: string; id: string }[];
  /** The zh story (after the lifted lede) opens with a bare subject. */
  zhBareSubject: { slug: string; id: string; excerpt: string }[];
  enOverSoftMax: { slug: string; id: string; length: number }[];
};

const BARE_SUBJECT = /^(?:品牌|產品)/u;

/** BD2-16. Paragraphs are split on a blank line, as `BrandAbout` renders them. */
export function auditParagraphing(
  brands: readonly AuditBrandRow[],
): ParagraphingSection {
  const section: ParagraphingSection = {
    zhSingleParagraph: [],
    enSingleParagraph: [],
    zhBareSubject: [],
    enOverSoftMax: [],
  };
  for (const brand of brands) {
    const ref = { slug: brand.slug, id: brand.id };
    const zh = brand.description?.trim() ?? "";
    const en = brand.description_en?.trim() ?? "";
    if (zh && !zh.includes("\n\n")) section.zhSingleParagraph.push(ref);
    if (en && !en.includes("\n\n")) section.enSingleParagraph.push(ref);
    if (zh) {
      // The same split the brand page uses: the story starts after the lede.
      const rest = splitLede(zh, "zh-TW").rest.trimStart();
      if (BARE_SUBJECT.test(rest)) {
        section.zhBareSubject.push({ ...ref, excerpt: excerptAround(rest, 0, 0) });
      }
    }
    if (en.length > EN_DESCRIPTION_SOFT_MAX) {
      section.enOverSoftMax.push({ ...ref, length: en.length });
    }
  }
  return section;
}

// ---------------------------------------------------------------------------
// Whole report
// ---------------------------------------------------------------------------

export type CatalogCopyReport = {
  totals: { brands: number; visibleProducts: number; activeImages: number };
  bannedTerms: BannedTermsSection;
  missingEnglish: MissingEnglishSection;
  duplicateDescriptions: DuplicateDescriptionGroup[];
  imageResolution: ImageResolutionSection;
  fullWidth: FullWidthHit[];
  taxonomy: TaxonomySection;
  paragraphing: ParagraphingSection;
};

/**
 * Pure: the full report. Products of brands outside `brands` (not approved)
 * are dropped here, so the caller can read products without a join.
 */
export function buildCatalogCopyReport(input: {
  brands: readonly AuditBrandRow[];
  products: readonly AuditProductRow[];
  images: readonly AuditImageRow[];
}): CatalogCopyReport {
  const brandsById = new Map(input.brands.map((brand) => [brand.id, brand]));
  const slugById = new Map(input.brands.map((brand) => [brand.id, brand.slug]));
  const products = input.products.filter((product) => brandsById.has(product.brand_id));
  const images = input.images.filter((image) => brandsById.has(image.brand_id));

  return {
    totals: {
      brands: input.brands.length,
      visibleProducts: products.length,
      activeImages: images.length,
    },
    bannedTerms: auditBannedTerms(input.brands),
    missingEnglish: auditMissingEnglish(products, slugById),
    duplicateDescriptions: auditDuplicateDescriptions(products, slugById),
    imageResolution: auditImageResolution(input.brands, images),
    fullWidth: auditFullWidth(input.brands, products, slugById),
    taxonomy: auditTaxonomy(products, brandsById),
    paragraphing: auditParagraphing(input.brands),
  };
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** Brands whose blurb/description a refresh `editorial` run would regenerate. */
export function editorialRefreshSlugs(report: CatalogCopyReport): string[] {
  return sortedUnique([
    ...report.bannedTerms.brands.map((brand) => brand.slug),
    ...report.paragraphing.zhSingleParagraph.map((brand) => brand.slug),
    ...report.paragraphing.enSingleParagraph.map((brand) => brand.slug),
    ...report.paragraphing.zhBareSubject.map((brand) => brand.slug),
    ...report.paragraphing.enOverSoftMax.map((brand) => brand.slug),
  ]);
}

/**
 * Curated-product ids the `--rewrite-descriptions` path can rewrite: duplicate
 * groups and variant-tai notes, `proposed_by = 'generated'` only, because that
 * is the only population the rewrite reads. The rest are returned separately
 * for hand editing.
 */
export function productRewriteIds(report: CatalogCopyReport): {
  generated: string[];
  manual: string[];
} {
  const generated: string[] = [];
  const manual: string[] = [];
  for (const group of report.duplicateDescriptions) {
    for (const member of group.members) {
      (member.generated ? generated : manual).push(member.id);
    }
  }
  for (const note of report.missingEnglish.taiVariantNotes) {
    (note.generated ? generated : manual).push(note.id);
  }
  return { generated: sortedUnique(generated), manual: sortedUnique(manual) };
}

/** The cohort JSON `scripts/enrichment/run/cohort.ts` loads: slugs are the `labels` keys. */
export function buildRefreshCohort(
  name: string,
  title: string,
  slugs: readonly string[],
): { name: string; title: string; subtitle: string; labels: Record<string, string> } {
  return {
    name,
    title,
    subtitle: "Generated by scripts/enrichment/data/catalog-copy-audit.ts (DEV-1989).",
    labels: Object.fromEntries(slugs.map((slug) => [slug, slug])),
  };
}

export function renderSummary(report: CatalogCopyReport): string[] {
  const lines: string[] = [];
  const { totals } = report;
  lines.push(
    `Scope: ${totals.brands} approved brands, ${totals.visibleProducts} visible curated products, ${totals.activeImages} active brand images.`,
    "",
    `[a] CP2-36 banned constructions in blurb/description: ${report.bannedTerms.brands.length} brands`,
  );
  for (const { key, label } of BANNED_PATTERNS) {
    lines.push(
      `    ${label.padEnd(18)} ${report.bannedTerms.brandsPerTerm[key]} brands, ${report.bannedTerms.hitsPerTerm[key]} hits`,
    );
  }
  for (const brand of report.bannedTerms.brands) {
    const first = brand.hits[0]!;
    lines.push(
      `    ${brand.slug} | ${brand.id} | ${brand.hits.length} hit(s) | ${first.label} (${first.field}): ${first.excerpt}`,
    );
  }

  const english = report.missingEnglish;
  lines.push(
    "",
    `[b] CP2-37 / BD2-05 visible products: ${english.missingDescriptionEn} without product_description_en, ${english.missingNameEn} without name_en, ${english.missingBoth} without both`,
    `    zh notes with \\u81fa: ${english.taiVariantNotes.length}`,
  );
  for (const note of english.taiVariantNotes) {
    lines.push(`    ${note.brandSlug} | ${note.id} | ${note.nameZh}: ${note.excerpt}`);
  }
  lines.push("    (full list of rows missing EN copy is in --json)");

  lines.push(
    "",
    `[c] BD2-27 duplicate zh product notes within one brand: ${report.duplicateDescriptions.length} groups`,
  );
  for (const group of report.duplicateDescriptions) {
    lines.push(
      `    ${group.brandSlug} | ${group.members.map((m) => `${m.id} ${m.nameZh}`).join(" ; ")} | ${group.excerpt}`,
    );
  }

  const images = report.imageResolution;
  lines.push(
    "",
    `[d] BD2-07 brands whose widest active image is < ${images.threshold}px: ${images.lowRes.length} (unknown width: ${images.unknownWidth.length}, no active image: ${images.noActiveImages.length})`,
  );
  for (const brand of images.lowRes) {
    lines.push(`    ${brand.slug} | ${brand.id} | max ${brand.maxWidth}px`);
  }

  const taxonomy = report.taxonomy;
  lines.push(
    "",
    `[e] BD2-26 full-width letters/digits: ${report.fullWidth.length} fields`,
  );
  for (const hit of report.fullWidth) {
    lines.push(`    ${hit.kind} ${hit.brandSlug} | ${hit.id} | ${hit.field}: ${hit.excerpt}`);
  }
  lines.push(
    `    subcategory from another L1 than the product category: ${taxonomy.productCategoryMismatch.length}`,
  );
  for (const row of taxonomy.productCategoryMismatch) {
    lines.push(
      `    ${row.brandSlug} | ${row.id} | ${row.nameZh} | ${row.subcategory} (${row.subcategoryL1}) vs product ${row.productCategory}`,
    );
  }
  lines.push(
    `    subcategory from another L1 than the brand category (review; may be legitimate): ${taxonomy.brandCategoryMismatch.length}`,
  );
  for (const row of taxonomy.brandCategoryMismatch) {
    lines.push(
      `    ${row.brandSlug} | ${row.id} | ${row.nameZh} | ${row.subcategory} (${row.subcategoryL1}) vs brand ${row.brandCategory}`,
    );
  }
  lines.push(`    unknown subcategory slug: ${taxonomy.unknownSubcategory.length}`);

  const paragraphs = report.paragraphing;
  lines.push(
    "",
    `[f] BD2-16 stories: zh single paragraph ${paragraphs.zhSingleParagraph.length}, EN single paragraph ${paragraphs.enSingleParagraph.length}, zh bare subject after the lede ${paragraphs.zhBareSubject.length}, EN > ${EN_DESCRIPTION_SOFT_MAX} chars ${paragraphs.enOverSoftMax.length}`,
  );
  for (const brand of paragraphs.zhBareSubject) {
    lines.push(`    ${brand.slug} | ${brand.id} | ${brand.excerpt}`);
  }
  return lines;
}

export const EDITORIAL_COHORT_FILE = "catalog-copy-editorial.json";
export const VISUAL_COHORT_FILE = "catalog-copy-visual.json";

/**
 * The existing commands that would act on the findings. Printed, never run.
 * `cohortDir` is where `--cohort-out` wrote the cohort files, or null.
 */
export function regenerationCommands(
  report: CatalogCopyReport,
  options: { target: "staging" | "production"; cohortDir: string | null },
): string[] {
  const targetFlag = options.target === "production" ? " --target production" : "";
  const cohortPath = (file: string) =>
    options.cohortDir ? join(options.cohortDir, file) : `<--cohort-out dir>/${file}`;
  const editorialSlugs = editorialRefreshSlugs(report);
  const visualSlugs = report.imageResolution.lowRes.map((brand) => brand.slug);
  const rewrite = productRewriteIds(report);
  const lines: string[] = ["", "=== Regeneration commands (not run; owner decides) ==="];

  lines.push(
    "",
    `# 1. Brand blurb + description (CP2-36, CP2-38, BD2-16): ${editorialSlugs.length} brands, via the brand refresh job.`,
    "#    The editorial task also reruns faq + stockists. Sample ~20 before applying:",
    "#    --no-apply leaves the refreshes in the /admin queue to approve there (never rerun refresh.ts to apply them).",
    `#    --slugs=${editorialSlugs.join(",")}`,
    `pnpm curation:rerun --cohort ${cohortPath(EDITORIAL_COHORT_FILE)} --task editorial${targetFlag} --dry-run`,
    `pnpm curation:rerun --cohort ${cohortPath(EDITORIAL_COHORT_FILE)} --task editorial${targetFlag} --no-apply --confirm`,
    "#    First push the updated prompt: pnpm llm-eval prompt push descriptions (then promote after eval).",
  );

  lines.push(
    "",
    `# 2. Curated-product zh notes (BD2-27 duplicates, \\u81fa notes): ${rewrite.generated.length} generated rows.`,
    "#    The dry run reads pages and calls the model to preview; it writes nothing.",
  );
  if (rewrite.generated.length > 0) {
    const ids = rewrite.generated.join(",");
    lines.push(
      `pnpm exec tsx scripts/enrichment/products/curated-products/batch-populate.ts --rewrite-descriptions --ids=${ids}${targetFlag}`,
      `pnpm exec tsx scripts/enrichment/products/curated-products/batch-populate.ts --rewrite-descriptions --ids=${ids}${targetFlag} --apply`,
    );
  }
  if (rewrite.manual.length > 0) {
    lines.push(
      `#    ${rewrite.manual.length} non-generated rows need a hand edit in /admin: --ids=${rewrite.manual.join(",")}`,
    );
  }

  lines.push(
    "",
    `# 3. EN product copy (BD2-05): ${report.missingEnglish.missingDescriptionEn} rows lack product_description_en.`,
    "#    No pipeline generates product_description_en today (gap reported on DEV-1989); nothing to run.",
  );

  lines.push(
    "",
    `# 4. Low-resolution heroes (BD2-07): ${visualSlugs.length} brands to re-collect images for.`,
    `#    --slugs=${visualSlugs.join(",")}`,
    `pnpm curation:rerun --cohort ${cohortPath(VISUAL_COHORT_FILE)} --task visual${targetFlag} --dry-run`,
  );

  lines.push(
    "",
    "# 5. BD2-26 taxonomy + rmc full-width letters (explicit fix list):",
    `pnpm exec tsx scripts/enrichment/products/curated-products/fix-bd2-26-taxonomy.ts${targetFlag}`,
  );
  return lines;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

const PAGE_SIZE = 1000;

function argValue(argv: readonly string[], flag: string): string | null {
  const inline = argv.find((argument) => argument.startsWith(`${flag}=`));
  if (inline) {
    const value = inline.slice(flag.length + 1);
    if (!value) throw new Error(`${flag} requires a path`);
    return value;
  }
  return null;
}

async function main(): Promise<void> {
  const { loadScriptTarget } = await import("../../shared/target");
  const { target, argv } = loadScriptTarget();
  const jsonPath = argValue(argv, "--json");
  const cohortDir = argValue(argv, "--cohort-out");

  const { createServiceClient } = await import("@/lib/supabase/service");
  const supabase = createServiceClient();

  const brands = await fetchAllRows<AuditBrandRow>(
    "brands",
    (from, to) =>
      supabase
        .from("brands")
        .select("id, slug, category, blurb, description, description_en")
        .eq("status", "approved")
        .order("id", { ascending: true })
        .range(from, to),
    PAGE_SIZE,
  );
  const products = await fetchAllRows<AuditProductRow>(
    "curated_products",
    (from, to) =>
      supabase
        .from("curated_products")
        .select(
          "id, brand_id, name_zh, name_en, product_description_zh, product_description_en, category, subcategory, proposed_by",
        )
        .eq("visible", true)
        .order("id", { ascending: true })
        .range(from, to),
    PAGE_SIZE,
  );
  const images = await fetchAllRows<AuditImageRow>(
    "brand_images",
    (from, to) =>
      supabase
        .from("brand_images")
        .select("brand_id, width")
        .eq("status", "active")
        .order("id", { ascending: true })
        .range(from, to),
    PAGE_SIZE,
  );

  const report = buildCatalogCopyReport({ brands, products, images });

  if (cohortDir) {
    mkdirSync(cohortDir, { recursive: true });
    const write = (file: string, cohort: ReturnType<typeof buildRefreshCohort>) =>
      writeFileSync(join(cohortDir, file), `${JSON.stringify(cohort, null, 2)}\n`);
    const editorial = editorialRefreshSlugs(report);
    const visual = report.imageResolution.lowRes.map((brand) => brand.slug);
    // cohort.ts rejects a cohort with no slugs, so an empty one is not written.
    if (editorial.length > 0) {
      write(
        EDITORIAL_COHORT_FILE,
        buildRefreshCohort("catalog-copy-editorial", "DEV-1989 blurb/description regeneration", editorial),
      );
    }
    if (visual.length > 0) {
      write(
        VISUAL_COHORT_FILE,
        buildRefreshCohort("catalog-copy-visual", "DEV-1989 low-resolution hero re-collection", visual),
      );
    }
  }

  console.log(`target: ${target}`);
  console.log(renderSummary(report).join("\n"));
  console.log(regenerationCommands(report, { target, cohortDir }).join("\n"));

  if (jsonPath) {
    writeFileSync(jsonPath, `${JSON.stringify({ target, ...report }, null, 2)}\n`);
    console.log(`\nFull report: ${jsonPath}`);
  }
}

// The test imports the pure functions, so importing must never start a run.
if (process.argv[1]?.endsWith("data/catalog-copy-audit.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
