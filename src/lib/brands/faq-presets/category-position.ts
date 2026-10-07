import { hasValue, type FaqPreset } from "./types";
import { noCommerceClaims, noKeywordStuffing } from "./validators";

const categoryPosition: FaqPreset = {
  id: "category-position",
  // Prompt-only preset: `render` is null, so the request path never consults
  // this predicate, and `authorable` below now overrides it for authoring.
  eligible: (ctx) =>
    hasValue(ctx.brand.categorySlug) && (ctx.peerStats?.peerCount ?? 0) > 0,
  // DEV-1954: no longer authored. The category already shows on the brand
  // page, and the model wrote this question 25+ ways, some asking about other
  // brands. Kept in the catalog (and its prompt in the snapshot) so stored
  // rows keep a known preset id; `scripts/delete-category-position-faq.ts`
  // removes the existing model rows.
  authorable: () => false,
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
