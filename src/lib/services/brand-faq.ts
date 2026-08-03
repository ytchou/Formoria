import type { Brand } from "@/lib/types";
import type { Database } from "@/lib/supabase/database.types";
import type { EnrichedFaqItem } from "@/lib/types/enriched-data";
import { createServiceClient } from "@/lib/supabase/server";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import { containsCjk } from "./taiwan-localization";

type TFn = (key: string, params?: Record<string, unknown>) => string;

type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

type BrandFaqEntry = {
  question_zh?: string | null;
  answer_zh?: string | null;
  question_en?: string | null;
  answer_en?: string | null;
};

const FAQ_COLUMN_ORDER = [
  "faq_products",
  "faq_price",
  "faq_where_to_buy",
  "faq_founded",
  "faq_reputation",
  "faq_custom_1",
  "faq_custom_2",
  "faq_custom_3",
  "faq_custom_4",
] as const;

export async function getBrandFaq(
  brandId: string,
  brand: Brand,
  t: TFn,
  locale: string = "zh-TW",
  cityLabel: string | null = null,
): Promise<FaqItem[]> {
  const supabase = createServiceClient();
  const { data: faqRow } = await supabase
    .from("brand_faq")
    .select("*")
    .eq("brand_id", brandId)
    .maybeSingle();

  const isZh = locale.startsWith("zh");
  const items: FaqItem[] = [];

  if (faqRow) {
    for (const column of FAQ_COLUMN_ORDER) {
      const entry = faqRow[column] as BrandFaqEntry | null;
      if (!entry) continue;
      const question = isZh ? entry.question_zh : entry.question_en;
      const answer = isZh ? entry.answer_zh : entry.answer_en;
      if (question && answer) {
        items.push({ id: column, question, answer });
      }
    }
  }

  const generated = buildBrandFaq(brand, t, locale, cityLabel);
  if (items.length > 0) {
    const mitItem = generated.find((item) => item.id === "made-in-taiwan");
    return mitItem ? [mitItem, ...items] : items;
  }

  return generated;
}

// ---------------------------------------------------------------------------
// Enrichment → brand_faq persistence
// ---------------------------------------------------------------------------

type BrandFaqColumn = (typeof FAQ_COLUMN_ORDER)[number];
type BrandFaqInsert = Database["public"]["Tables"]["brand_faq"]["Insert"];

/** The curation prompt's closed `category` set, minus `custom` (which overflows). */
const FAQ_CATEGORY_COLUMNS: Record<string, BrandFaqColumn> = {
  products: "faq_products",
  price: "faq_price",
  where_to_buy: "faq_where_to_buy",
  founded: "faq_founded",
  reputation: "faq_reputation",
};

const FAQ_CUSTOM_COLUMNS: BrandFaqColumn[] = [
  "faq_custom_1",
  "faq_custom_2",
  "faq_custom_3",
  "faq_custom_4",
];

/**
 * A column counts as filled when either locale is renderable, because that is
 * exactly what `getBrandFaq` will surface. A half-written entry (zh only) is
 * still someone's answer, so it blocks the fill-gaps write rather than being
 * treated as a gap worth completing from a different source.
 */
function isFilledFaqEntry(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as BrandFaqEntry;
  return (
    (hasValue(entry.question_zh) && hasValue(entry.answer_zh)) ||
    (hasValue(entry.question_en) && hasValue(entry.answer_en))
  );
}

/**
 * Pairs the flat, bilingual item list the `descriptions` phase emits into the
 * `{ question_zh, answer_zh, question_en, answer_en }` shape `getBrandFaq`
 * reads. The prompt contract is zh-then-en for the same logical question, so
 * language is detected per item and the two per-category streams are zipped by
 * position — that survives a model that skips one side of a pair, which
 * strict alternation would silently mis-align for every item after it.
 *
 * Exported for tests: the pairing rules are where this file's bugs will live,
 * and they are worth asserting without a database in the loop.
 */
export function buildFaqColumnsFromEnrichment(
  faqItems: EnrichedFaqItem[],
): Partial<Record<BrandFaqColumn, BrandFaqEntry>> {
  const zhByCategory = new Map<string, EnrichedFaqItem[]>();
  const enByCategory = new Map<string, EnrichedFaqItem[]>();

  for (const item of faqItems ?? []) {
    const category = item?.category;
    // An unknown category has nowhere to land. Dropping it keeps a prompt
    // change (new category, old code) from failing the whole write.
    if (!category) continue;
    if (category !== "custom" && !(category in FAQ_CATEGORY_COLUMNS)) continue;
    if (!hasValue(item.question) || !hasValue(item.answer)) continue;

    const bucket = containsCjk(item.question) ? zhByCategory : enByCategory;
    const existing = bucket.get(category);
    if (existing) existing.push(item);
    else bucket.set(category, [item]);
  }

  const pairsByCategory = new Map<string, BrandFaqEntry[]>();
  for (const category of new Set([
    ...zhByCategory.keys(),
    ...enByCategory.keys(),
  ])) {
    const zh = zhByCategory.get(category) ?? [];
    const en = enByCategory.get(category) ?? [];
    const pairs: BrandFaqEntry[] = [];
    for (let index = 0; index < Math.max(zh.length, en.length); index++) {
      pairs.push({
        question_zh: zh[index]?.question ?? null,
        answer_zh: zh[index]?.answer ?? null,
        question_en: en[index]?.question ?? null,
        answer_en: en[index]?.answer ?? null,
      });
    }
    pairsByCategory.set(category, pairs);
  }

  const columns: Partial<Record<BrandFaqColumn, BrandFaqEntry>> = {};
  for (const [category, column] of Object.entries(FAQ_CATEGORY_COLUMNS)) {
    // One column per fixed category: the schema has no room for a second
    // `price` question, so extra pairs are dropped rather than overflowing
    // into the custom slots a genuinely custom question needs.
    const entry = pairsByCategory.get(category)?.[0];
    if (entry) columns[column] = entry;
  }

  const customPairs = pairsByCategory.get("custom") ?? [];
  FAQ_CUSTOM_COLUMNS.forEach((column, index) => {
    const entry = customPairs[index];
    if (entry) columns[column] = entry;
  });

  return columns;
}

/**
 * Writes the enrichment FAQ into `brand_faq`, filling gaps only.
 *
 * FILL-GAPS-ONLY is load-bearing: a populated column may have been hand-edited
 * by an admin or a brand owner, and this runs on every refresh apply. Blindly
 * upserting would let a re-run of the model quietly overwrite human copy with
 * no audit trail and no way back. Correcting bad existing FAQ text is a
 * separate, deliberate validation pass — never a side effect of enrichment.
 *
 */
export async function upsertBrandFaqFromEnrichment(
  brandId: string,
  faqItems: EnrichedFaqItem[],
): Promise<void> {
  const candidates = buildFaqColumnsFromEnrichment(faqItems ?? []);
  // Nothing usable in the payload — return before touching the database at all,
  // so an un-enriched brand costs zero queries on every apply.
  if (Object.keys(candidates).length === 0) return;

  const supabase = createServiceClient();
  const { data: existingRow, error: readError } = await supabase
    .from("brand_faq")
    .select("*")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (readError) throw readError;

  const existing = (existingRow ?? {}) as unknown as Record<string, unknown>;
  const patch: Record<string, BrandFaqEntry> = {};
  for (const [column, entry] of Object.entries(candidates)) {
    if (!entry) continue;
    if (isFilledFaqEntry(existing[column])) continue;
    patch[column] = entry;
  }
  if (Object.keys(patch).length === 0) return;

  // `upsert` rather than branching on `existingRow`: it inserts when the row is
  // absent and updates only the listed columns when it is not, which also
  // closes the read-then-write race between two concurrent applies.
  const { error: writeError } = await supabase
    .from("brand_faq")
    .upsert({ brand_id: brandId, ...patch } as unknown as BrandFaqInsert, {
      onConflict: "brand_id",
    });
  if (writeError) throw writeError;
}

type FaqGenerator = {
  id: string;
  condition: (brand: Brand, locale: string) => boolean;
  questionKey: string;
  buildAnswer: (
    brand: Brand,
    t: TFn,
    locale: string,
    cityLabel: string | null,
  ) => string;
};

const PRICE_RANGE_KEYS: Record<1 | 2 | 3, string> = {
  1: "brandFaq.priceRanges.budget",
  2: "brandFaq.priceRanges.midRange",
  3: "brandFaq.priceRanges.premium",
};

function hasValue(value: string | null | undefined): value is string {
  return value != null && value.trim() !== "";
}

function hasMinLength(
  value: string | null | undefined,
  minLength: number,
): value is string {
  return value != null && value.trim().length >= minLength;
}

function compactValues(values: Array<string | null | undefined>): string[] {
  return values.filter(hasValue);
}

function truncate<T>(items: T[], limit = 3): T[] {
  return items.slice(0, limit);
}

function collectPurchaseLinks(brand: Brand, t: TFn): string[] {
  const links: string[] = [];

  if (hasValue(brand.purchaseWebsite))
    links.push(`[${t("brandFaq.channels.website")}](${brand.purchaseWebsite})`);
  if (hasValue(brand.purchasePinkoi))
    links.push(`[${t("brandFaq.channels.pinkoi")}](${brand.purchasePinkoi})`);
  if (hasValue(brand.purchaseShopee))
    links.push(`[${t("brandFaq.channels.shopee")}](${brand.purchaseShopee})`);

  return links;
}

function collectSocialLinks(brand: Brand): string[] {
  const links: string[] = [];

  if (hasValue(brand.socialInstagram))
    links.push(`[Instagram](${brand.socialInstagram})`);
  if (hasValue(brand.socialThreads))
    links.push(`[Threads](${brand.socialThreads})`);
  if (hasValue(brand.socialFacebook))
    links.push(`[Facebook](${brand.socialFacebook})`);

  return links;
}

function buildWhereToBuyAnswer(brand: Brand, t: TFn): string {
  const links = collectPurchaseLinks(brand, t);
  const sep = t("brandFaq.listSeparator");
  return t("brandFaq.whereToBuy.answer", {
    brandName: brand.name,
    channels: truncate(links).join(sep),
  });
}

function buildMainProductsAnswer(
  brand: Brand,
  t: TFn,
  locale: string,
  cityLabel: string | null,
): string {
  const isEnglish = locale === "en";
  const category = isEnglish
    ? PRODUCT_TYPE_CATEGORIES.find((item) => item.slug === brand.productType)
        ?.name
    : brand.category;
  const sep = t("brandFaq.listSeparator");
  const productTags = truncate(
    isEnglish ? (brand.productTagsEn ?? []) : (brand.productTags ?? []),
  ).join(sep);
  const context = buildBrandContext(brand, t, cityLabel);

  if (category && productTags) {
    return t("brandFaq.mainProducts.answerWithCategoryAndTags", {
      brandName: brand.name,
      category,
      productTags,
      context,
    });
  }

  return t("brandFaq.mainProducts.answerWithTags", {
    brandName: brand.name,
    productTags,
    context,
  });
}

function buildPriceRangeAnswer(brand: Brand, t: TFn): string {
  const rangeKey = brand.priceRange as 1 | 2 | 3;
  return t("brandFaq.priceRange.answer", {
    brandName: brand.name,
    range: t(PRICE_RANGE_KEYS[rangeKey]),
  });
}

function buildFoundedAnswer(
  brand: Brand,
  t: TFn,
  _locale: string,
  cityLabel: string | null,
): string {
  return t("brandFaq.whenFounded.answer", {
    brandName: brand.name,
    year: brand.foundingYear,
    context: buildBrandContext(brand, t, cityLabel),
  });
}

function buildOfficialAccountsAnswer(brand: Brand, t: TFn): string {
  const sep = t("brandFaq.listSeparator");
  return t("brandFaq.officialAccounts.answer", {
    brandName: brand.name,
    accounts: collectSocialLinks(brand).join(sep),
  });
}

function buildReputationAnswer(
  brand: Brand,
  t: TFn,
  locale: string,
  cityLabel: string | null,
): string {
  const summary =
    locale === "en"
      ? (brand.reputationSummary?.textEn ?? "")
      : (brand.reputationSummary?.text ?? "");
  return t("brandFaq.reputation.answer", {
    brandName: brand.name,
    summary,
    context: buildBrandContext(brand, t, cityLabel),
  });
}

function buildBrandContext(
  brand: Brand,
  t: TFn,
  cityLabel: string | null,
): string {
  const details = compactValues([
    cityLabel ? t("brandFaq.context.city", { city: cityLabel }) : null,
    brand.foundingYear
      ? t("brandFaq.context.founded", { year: brand.foundingYear })
      : null,
  ]);

  return details.length > 0
    ? t("brandFaq.context.suffix", {
        details: details.join(t("brandFaq.listSeparator")),
      })
    : "";
}

function buildMitAnswer(brand: Brand, t: TFn): string {
  if (brand.mitStatus === "verified") {
    const verifiedAnswer = t("brandFaq.isMadeInTaiwan.answer", {
      brandName: brand.name,
    });
    const registrySource = t("brandFaq.isMadeInTaiwan.registrySource");
    return hasValue(brand.mitStory)
      ? `${brand.mitStory}\n\n${verifiedAnswer} ${registrySource}`
      : `${verifiedAnswer} ${registrySource}`;
  }

  const scope = brand.mitDeclaredScope
    ? t(`brandFaq.isMadeInTaiwan.scopeLabels.${brand.mitDeclaredScope}`)
    : t("brandFaq.isMadeInTaiwan.scopeLabels.unspecified");
  const declaration = t("brandFaq.isMadeInTaiwan.declaredAnswer", {
    brandName: brand.name,
    scope,
  });
  const story = hasValue(brand.mitStory) ? `\n\n${brand.mitStory}` : "";

  return `${declaration}${story}`;
}

const FAQ_GENERATORS: FaqGenerator[] = [
  {
    id: "made-in-taiwan",
    condition: (brand) =>
      brand.mitStatus === "declared" || brand.mitStatus === "verified",
    questionKey: "brandFaq.isMadeInTaiwan.question",
    buildAnswer: buildMitAnswer,
  },
  {
    id: "where-to-buy",
    condition: (brand) =>
      [brand.purchaseWebsite, brand.purchasePinkoi, brand.purchaseShopee].some(
        hasValue,
      ),
    questionKey: "brandFaq.whereToBuy.question",
    buildAnswer: buildWhereToBuyAnswer,
  },
  {
    id: "main-products",
    condition: (brand, locale) =>
      compactValues(locale === "en" ? brand.productTagsEn : brand.productTags)
        .length > 0,
    questionKey: "brandFaq.mainProducts.question",
    buildAnswer: buildMainProductsAnswer,
  },
  {
    id: "price-range",
    condition: (brand) => [1, 2, 3].includes(brand.priceRange ?? 0),
    questionKey: "brandFaq.priceRange.question",
    buildAnswer: buildPriceRangeAnswer,
  },
  {
    id: "founded",
    condition: (brand) => Boolean(brand.foundingYear),
    questionKey: "brandFaq.whenFounded.question",
    buildAnswer: buildFoundedAnswer,
  },
  {
    id: "official-accounts",
    condition: (brand) =>
      [brand.socialInstagram, brand.socialThreads, brand.socialFacebook].some(
        hasValue,
      ),
    questionKey: "brandFaq.officialAccounts.question",
    buildAnswer: buildOfficialAccountsAnswer,
  },
  {
    id: "reputation",
    condition: (brand, locale) =>
      hasMinLength(
        locale === "en"
          ? brand.reputationSummary?.textEn
          : brand.reputationSummary?.text,
        10,
      ),
    questionKey: "brandFaq.reputation.question",
    buildAnswer: buildReputationAnswer,
  },
];

export function buildBrandFaq(
  brand: Brand,
  t: TFn,
  locale: string = "zh-TW",
  cityLabel: string | null = null,
): FaqItem[] {
  return FAQ_GENERATORS.filter((generator) =>
    generator.condition(brand, locale),
  ).map((generator) => ({
    id: generator.id,
    question: t(generator.questionKey, { brandName: brand.name }),
    answer: generator.buildAnswer(brand, t, locale, cityLabel),
  }));
}
