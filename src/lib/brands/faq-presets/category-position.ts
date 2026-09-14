import { hasValue, type FaqPreset } from "./types";
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
  promptFragment: {
    prompt: "faq-category-position",
    variables: (ctx) => ({
      brand_name: ctx.brand.name,
      category_slug: ctx.brand.categorySlug ?? "",
      peer_count: String(ctx.peerStats?.peerCount ?? 0),
    }),
  },
  // `groundedIn(requiredEvidence)` is derived once in the registry (index.ts),
  // so the declared evidence contract and the enforced one cannot diverge.
  validators: [noCommerceClaims(), noKeywordStuffing()],
};

export default categoryPosition;
