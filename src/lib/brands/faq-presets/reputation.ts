import {
  buildBrandContextSuffix,
  type FaqPreset,
} from "./types";
import {
  noKeywordStuffing,
  noCommerceClaims,
  notDuplicateOf,
  pureLanguage,
  withinLengthBand,
} from "./validators";
import { faqReputationPrompt } from "@/lib/prompts";

const reputation: FaqPreset = {
  id: "reputation",
  eligible: (ctx) =>
    (ctx.brand.reputationSummary?.text?.trim().length ?? 0) >= 10 ||
    (ctx.brand.reputationSummary?.textEn?.trim().length ?? 0) >= 10,
  requiredEvidence: ["reputationSummary"],
  render: {
    questionKey: "brandFaq.reputation.question",
    templateFloor: (ctx, t, locale) => {
      const summary = locale.startsWith("en")
        ? ctx.brand.reputationSummary?.textEn ??
          ctx.brand.reputationSummary?.text ??
          ""
        : ctx.brand.reputationSummary?.text ??
          ctx.brand.reputationSummary?.textEn ??
          "";
      return t("brandFaq.reputation.answer", {
        brandName: ctx.brand.name,
        summary,
        context: buildBrandContextSuffix(ctx, t),
      });
    },
  },
  promptFragment: (ctx) => {
    const summary = ctx.brand.reputationSummary?.textEn ?? ctx.brand.reputationSummary?.text ?? "";
    return faqReputationPrompt(summary);
  },
  // `groundedIn(requiredEvidence)` is derived in the registry (index.ts).
  validators: [
    pureLanguage(),
    withinLengthBand(),
    noCommerceClaims(),
    noKeywordStuffing(),
    notDuplicateOf(),
  ],
};

export default reputation;
