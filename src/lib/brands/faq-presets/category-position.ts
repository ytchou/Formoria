import { hasValue, type FaqPreset } from "./types";
import { noPricingFigures } from "./validators";

const categoryPosition: FaqPreset = {
  id: "category-position",
  eligible: (ctx) =>
    hasValue(ctx.brand.productType) && (ctx.peerStats?.peerCount ?? 0) > 0,
  requiredEvidence: ["productType", "peerStats"],
  templateFloor: null,
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

    return `品牌「${ctx.brand.name}」的比較定位資料：同類別 ${stats.peerCount} 個品牌；序位分布為${distribution}；主要城市群為${cities || "無"}。請先給出結論，再以這些資料說明品牌在 ${ctx.brand.productType} 類別中的相對位置。只能使用比較與序位語言，不得輸出任何貨幣符號、金額或價格數字。`;
  },
  validators: [noPricingFigures()],
};

export default categoryPosition;
