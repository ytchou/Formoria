import {
  noKeywordStuffing,
  noPricingFigures,
  notDuplicateOf,
  pureLanguage,
  withinLengthBand,
} from "./validators";
import type { Brand } from "@/lib/types";
import type { FaqPreset } from "./types";

const PRICE_RANGE_KEYS: Record<1 | 2 | 3, string> = {
  1: "brandFaq.priceRanges.budget",
  2: "brandFaq.priceRanges.midRange",
  3: "brandFaq.priceRanges.premium",
};

function priceBucket(brand: Brand): 1 | 2 | 3 | null {
  const range = brand.priceRange;
  return range === 1 || range === 2 || range === 3 ? range : null;
}

const pricePositioning: FaqPreset = {
  id: "price-positioning",
  // Render eligibility gates on `priceRange` alone. Peer stats are an
  // enrichment-pipeline concern and are never fetched in the page request
  // path, so requiring them here would make the floor unreachable and drop
  // this question from every brand page.
  eligible: (ctx) => priceBucket(ctx.brand) !== null,
  // Authoring is a different question: the *prompt* is comparative, so the
  // model may only write this answer when it has the peer distribution.
  authorable: (ctx) => priceBucket(ctx.brand) !== null && ctx.peerStats != null,
  requiredEvidence: ["priceRange", "peerStats"],
  render: {
    questionKey: "brandFaq.priceRange.question",
    templateFloor: (ctx, t) => {
      const bucket = priceBucket(ctx.brand);
      return t("brandFaq.priceRange.answer", {
        brandName: ctx.brand.name,
        range: bucket === null ? "" : t(PRICE_RANGE_KEYS[bucket]),
      });
    },
  },
  promptFragment: (ctx) =>
    `請為品牌「${ctx.brand.name}」撰寫比較性的序位定位回答，只能使用相對與序位描述。禁止輸出 NT$、元、任何貨幣符號、貨幣名稱或金額數字。`,
  // `groundedIn(requiredEvidence)` is derived in the registry (index.ts), and
  // it still requires `peerStats` — validators only ever run on model output.
  validators: [
    pureLanguage(),
    withinLengthBand(),
    noPricingFigures(),
    noKeywordStuffing(),
    notDuplicateOf(),
  ],
};

export default pricePositioning;
