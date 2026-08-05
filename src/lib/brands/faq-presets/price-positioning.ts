import {
  groundedIn,
  noPricingFigures,
  notDuplicateOf,
  pureLanguage,
  withinLengthBand,
} from "./validators";
import type { FaqPreset } from "./types";

const PRICE_RANGE_KEYS: Record<1 | 2 | 3, string> = {
  1: "brandFaq.priceRanges.budget",
  2: "brandFaq.priceRanges.midRange",
  3: "brandFaq.priceRanges.premium",
};

const pricePositioning: FaqPreset = {
  id: "price-positioning",
  eligible: (ctx) =>
    (ctx.brand.priceRange === 1 ||
      ctx.brand.priceRange === 2 ||
      ctx.brand.priceRange === 3) &&
    ctx.peerStats != null,
  requiredEvidence: ["priceRange", "peerStats"],
  templateFloor: (ctx, t) =>
    t("brandFaq.priceRange.answer", {
      brandName: ctx.brand.name,
      range: t(PRICE_RANGE_KEYS[ctx.brand.priceRange as 1 | 2 | 3]),
    }),
  promptFragment: (ctx) =>
    `請為品牌「${ctx.brand.name}」撰寫比較性的序位定位回答，只能使用相對與序位描述。禁止輸出 NT$、元、任何貨幣符號、貨幣名稱或金額數字。`,
  validators: [
    pureLanguage(),
    withinLengthBand(),
    groundedIn(["priceRange", "peerStats"]),
    noPricingFigures(),
    notDuplicateOf(),
  ],
};

export default pricePositioning;
