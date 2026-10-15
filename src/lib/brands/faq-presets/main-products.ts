import { subcategoryBySlug } from "@/lib/taxonomy/ontology";
import {
  formatFaqList,
  hasValue,
  lowercaseLabelForSentence,
  type FaqBrandContext,
  type FaqPreset,
} from "./types";
import {
  noKeywordStuffing,
  noCommerceClaims,
  notDuplicateOf,
  pureLanguage,
  withinLengthBand,
} from "./validators";

/** The floor names at most this many subcategories. */
const FLOOR_LIMIT = 3;

/**
 * The labels the floor lists, for one locale, read ONLY from the brand's
 * published curated products (BD-10). The floor used to read
 * `brands.subcategories`, and on a brand page that list often contradicted
 * the product shelf right above it. A brand with no curated products
 * therefore gets no floor at all — the FAQ renders only when it says
 * something the page itself backs up.
 *
 * Slugs are ranked by how many shelf products carry each (most first), ties
 * kept in shelf order. Slugs the ontology does not know are skipped: a raw
 * slug would be Latin text inside published zh-TW copy. The floor
 * interpolates this array directly, so eligibility is judged on the *same*
 * array, for the *same* locale — an empty list must never reach the page.
 */
function shelfLabels(ctx: FaqBrandContext, locale: string): string[] {
  const counts = new Map<string, number>();
  for (const slug of ctx.curatedSubcategories ?? []) {
    if (!hasValue(slug)) continue;
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const isEnglish = locale.startsWith("en");
  // Map iteration is insertion order (first appearance), and Array.sort is
  // stable, so equal counts keep shelf order.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .flatMap(([slug]) => {
      const subcategory = subcategoryBySlug(slug);
      if (!subcategory) return [];
      return [isEnglish ? subcategory.nameEn : subcategory.nameZh];
    })
    .slice(0, FLOOR_LIMIT);
}

/** zh labels as stored; en labels lowered to sentence case for mid-sentence use. */
function subcategories(ctx: FaqBrandContext, locale: string): string {
  const labels = shelfLabels(ctx, locale);
  return formatFaqList(
    locale.startsWith("en") ? labels.map(lowercaseLabelForSentence) : labels,
    locale,
  );
}

const mainProducts: FaqPreset = {
  id: "main-products",
  // BD-10: renders only when the curated shelf supplies at least one known
  // subcategory. Without that, the answer would interpolate an empty list
  // ("Acme's range includes .") or fall back to `brands.subcategories`, which
  // is the list that contradicted the shelf.
  eligible: (ctx, locale = "zh-TW") => shelfLabels(ctx, locale).length > 0,
  // Authoring writes both locale sides from the zh evidence, so the zh tags
  // are what decide whether the model has anything to work from.
  authorable: (ctx) => ctx.brand.subcategories.some(hasValue),
  requiredEvidence: ["subcategories"],
  render: {
    questionKey: "brandFaq.mainProducts.question",
    // DEV-1994: subcategories only. The category, city and founding year are
    // on the page's metadata line already; restating them read as a template.
    // BD-10: those subcategories come from the curated shelf, never from
    // `brands.subcategories`.
    templateFloor: (ctx, t, locale) =>
      t("brandFaq.mainProducts.answer", {
        brandName: ctx.brand.name,
        subcategories: subcategories(ctx, locale),
      }),
  },
  promptFragment: {
    prompt: "faq-main-products",
    variables: (ctx) => ({ brand_name: ctx.brand.name }),
  },
  // `groundedIn(requiredEvidence)` is derived in the registry (index.ts).
  validators: [
    pureLanguage(),
    withinLengthBand(),
    noCommerceClaims(),
    noKeywordStuffing(),
    notDuplicateOf(),
  ],
};

export default mainProducts;
