import { hasValue, type FaqPreset } from "./types";
import { noKeywordStuffing, noPricingFigures } from "./validators";

const categoryPosition: FaqPreset = {
  id: "category-position",
  // Prompt-only preset: `render` is null, so the request path never consults
  // this predicate. It reads purely as authoring eligibility, which is why the
  // peer-stats requirement stays on it.
  eligible: (ctx) =>
    hasValue(ctx.brand.categorySlug) && (ctx.peerStats?.peerCount ?? 0) > 0,
  requiredEvidence: ["categorySlug", "peerStats"],
  render: null,
  promptFragment: (ctx) => {
    const stats = ctx.peerStats;
    if (!stats) return "";

    const distribution = ([1, 2, 3] as const)
      .map((bucket) => `${bucket}序位桶 ${stats.priceDistribution[bucket]} 個品牌`)
      .join("、");
    const cities = stats.cityClusters
      .slice(0, 3)
      .map((cluster) => `${cluster.city} ${cluster.count} 個`)
      .join("、");

    return `品牌「${ctx.brand.name}」的比較定位資料：同類別 ${stats.peerCount} 個品牌；序位分布為${distribution}；主要城市群為${cities || "無"}。請先給出結論，再以這些資料說明品牌在 ${ctx.brand.categorySlug} 類別中的相對位置。只能使用比較與序位語言，不得輸出任何貨幣符號、金額或價格數字。`;
  },
  // `groundedIn(requiredEvidence)` is derived once in the registry (index.ts),
  // so the declared evidence contract and the enforced one cannot diverge.
  validators: [noPricingFigures(), noKeywordStuffing()],
};

export default categoryPosition;
