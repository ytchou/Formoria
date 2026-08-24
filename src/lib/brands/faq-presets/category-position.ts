import { hasValue, type FaqPreset } from "./types";
import { faqCategoryPositionPrompt } from "@/lib/prompts";
import { noCommerceClaims, noKeywordStuffing } from "./validators";

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

    const cities = stats.cityClusters
      .slice(0, 3)
      .map((cluster) => `${cluster.city}: ${cluster.count}`)
      .join(", ");

    return faqCategoryPositionPrompt({
      brandName: ctx.brand.name,
      categorySlug: ctx.brand.categorySlug ?? "",
      peerCount: stats.peerCount,
      cities,
    });
  },
  // `groundedIn(requiredEvidence)` is derived once in the registry (index.ts),
  // so the declared evidence contract and the enforced one cannot diverge.
  validators: [noCommerceClaims(), noKeywordStuffing()],
};

export default categoryPosition;
