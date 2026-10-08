import { getBrandSubcategoryLabels } from "@/lib/brands/category-label";
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

/**
 * The tags for one locale. The floor interpolates these directly, so an empty
 * result must never reach a rendered answer — eligibility is judged on the
 * *same* array the floor will read, for the *same* locale.
 *
 * Two arrays are in play and they answer different questions. The locale's own
 * array decides *whether* this preset renders — a brand with no en tags must
 * not produce an en answer. What the answer *says* comes from the ontology:
 * `subcategories` stores English slugs since DEV-1510, and this is published
 * zh-TW copy, so a raw slug here is Latin text on a public
 * page. The two arrays are index-aligned by `deriveSubcategoriesEn`.
 */
function localeTags(ctx: FaqBrandContext, locale: string): string[] {
  const source = locale.startsWith("en")
    ? ctx.brand.subcategoriesEn
    : ctx.brand.subcategories;
  const labels = getBrandSubcategoryLabels(ctx.brand, locale);
  return source
    .map((tag, index) => (hasValue(tag) ? (labels.at(index) ?? tag) : null))
    .filter(hasValue)
    .slice(0, 3);
}

/** zh labels as stored; en labels lowered to sentence case for mid-sentence use. */
function subcategories(ctx: FaqBrandContext, locale: string): string {
  const tags = localeTags(ctx, locale);
  return formatFaqList(
    locale.startsWith("en") ? tags.map(lowercaseLabelForSentence) : tags,
    locale,
  );
}

const mainProducts: FaqPreset = {
  id: "main-products",
  // A brand with zh tags and an empty `subcategoriesEn` is eligible in zh and
  // not in en. Rendering it in en would interpolate an empty string into
  // the page ("Acme's products include .").
  eligible: (ctx, locale = "zh-TW") => localeTags(ctx, locale).length > 0,
  // Authoring writes both locale sides from the zh evidence, so the zh tags
  // are what decide whether the model has anything to work from.
  authorable: (ctx) => ctx.brand.subcategories.some(hasValue),
  requiredEvidence: ["subcategories"],
  render: {
    questionKey: "brandFaq.mainProducts.question",
    // DEV-1994: subcategories only. The category, city and founding year are
    // on the page's metadata line already; restating them read as a template.
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
