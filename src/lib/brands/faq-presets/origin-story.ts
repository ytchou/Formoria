import type { FaqPreset } from "./types";
import {
  noKeywordStuffing,
  noCommerceClaims,
  notDuplicateOf,
  pureLanguage,
  withinLengthBand,
} from "./validators";

const originStory: FaqPreset = {
  id: "origin-story",
  eligible: (ctx) =>
    ctx.brand.foundingYear != null && (ctx.brand.city?.trim().length ?? 0) > 0,
  requiredEvidence: ["foundingYear", "city"],
  render: {
    questionKey: "brandFaq.originStory.question",
    templateFloor: (ctx, t) =>
      t("brandFaq.originStory.answer", {
        brandName: ctx.brand.name,
        year: ctx.brand.foundingYear,
        city: ctx.cityLabel ?? ctx.brand.city ?? "",
        context: "",
      }),
  },
  promptFragment: null,
  // `groundedIn(requiredEvidence)` is derived in the registry (index.ts).
  validators: [
    pureLanguage(),
    withinLengthBand(),
    noCommerceClaims(),
    noKeywordStuffing(),
    notDuplicateOf(),
  ],
};

export default originStory;
