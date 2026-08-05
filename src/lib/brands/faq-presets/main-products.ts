import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import {
  buildBrandContextSuffix,
  hasValue,
  type FaqBrandContext,
  type FaqPreset,
  type FaqTFn,
} from "./types";
import {
  noKeywordStuffing,
  noPricingFigures,
  notDuplicateOf,
  pureLanguage,
  withinLengthBand,
} from "./validators";

/**
 * The tags for one locale. The floor interpolates these directly, so an empty
 * result must never reach a rendered answer — eligibility is judged on the
 * *same* array the floor will read, for the *same* locale.
 */
function localeTags(ctx: FaqBrandContext, locale: string): string[] {
  const tags = locale.startsWith("en")
    ? ctx.brand.productTagsEn
    : ctx.brand.productTags;
  return tags.filter(hasValue).slice(0, 3);
}

function productTags(ctx: FaqBrandContext, t: FaqTFn, locale: string): string {
  return localeTags(ctx, locale).join(t("brandFaq.listSeparator"));
}

const mainProducts: FaqPreset = {
  id: "main-products",
  // A brand with zh tags and an empty `productTagsEn` is eligible in zh and
  // not in en. Rendering it in en would interpolate an empty string into both
  // the page and the FAQPage JSON-LD ("Acme makes  as signature products.").
  eligible: (ctx, locale = "zh-TW") => localeTags(ctx, locale).length > 0,
  // Authoring writes both locale sides from the zh evidence, so the zh tags
  // are what decide whether the model has anything to work from.
  authorable: (ctx) => ctx.brand.productTags.some(hasValue),
  requiredEvidence: ["productTags"],
  render: {
    questionKey: "brandFaq.mainProducts.question",
    templateFloor: (ctx, t, locale) => {
      const isEnglish = locale.startsWith("en");
      const category = isEnglish
        ? PRODUCT_TYPE_CATEGORIES.find(
            (item) => item.slug === ctx.brand.productType,
          )?.name
        : ctx.brand.category;
      const tags = productTags(ctx, t, locale);
      const context = buildBrandContextSuffix(ctx, t);

      if (category && tags) {
        return t("brandFaq.mainProducts.answerWithCategoryAndTags", {
          brandName: ctx.brand.name,
          category,
          productTags: tags,
          context,
        });
      }

      return t("brandFaq.mainProducts.answerWithTags", {
        brandName: ctx.brand.name,
        productTags: tags,
        context,
      });
    },
  },
  promptFragment: (ctx) =>
    `請以品牌「${ctx.brand.name}」提供的產品標籤為基礎，補充可驗證的材料、製程或工藝細節；不可捏造來源沒有提供的資訊。`,
  // `groundedIn(requiredEvidence)` is derived in the registry (index.ts).
  validators: [
    pureLanguage(),
    withinLengthBand(),
    noPricingFigures(),
    noKeywordStuffing(),
    notDuplicateOf(),
  ],
};

export default mainProducts;
