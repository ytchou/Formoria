import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import {
  buildBrandContextSuffix,
  hasValue,
  type FaqBrandContext,
  type FaqPreset,
  type FaqTFn,
} from "./types";
import {
  groundedIn,
  notDuplicateOf,
  pureLanguage,
  withinLengthBand,
} from "./validators";

function productTags(
  ctx: FaqBrandContext,
  t: FaqTFn,
  locale: string,
): string {
  const tags = locale.startsWith("en")
    ? ctx.brand.productTagsEn
    : ctx.brand.productTags;
  return tags.filter(hasValue).slice(0, 3).join(t("brandFaq.listSeparator"));
}

const mainProducts: FaqPreset = {
  id: "main-products",
  eligible: (ctx) => ctx.brand.productTags.some(hasValue),
  requiredEvidence: ["productTags"],
  templateFloor: (ctx, t, locale) => {
    const isEnglish = locale.startsWith("en");
    const category = isEnglish
      ? PRODUCT_TYPE_CATEGORIES.find((item) => item.slug === ctx.brand.productType)
          ?.name
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
  promptFragment: (ctx) =>
    `請以品牌「${ctx.brand.name}」提供的產品標籤為基礎，補充可驗證的材料、製程或工藝細節；不可捏造來源沒有提供的資訊。`,
  validators: [
    pureLanguage(),
    withinLengthBand(),
    groundedIn(["productTags"]),
    notDuplicateOf(),
  ],
};

export default mainProducts;
