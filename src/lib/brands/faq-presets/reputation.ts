import {
  buildBrandContextSuffix,
  type FaqPreset,
} from "./types";
import {
  noKeywordStuffing,
  noPricingFigures,
  notDuplicateOf,
  pureLanguage,
  withinLengthBand,
} from "./validators";

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
    return `只能根據以下已提供的聲譽摘要回答，不得加入摘要以外的評價、評分或媒體資訊：${summary}`;
  },
  // `groundedIn(requiredEvidence)` is derived in the registry (index.ts).
  validators: [
    pureLanguage(),
    withinLengthBand(),
    noPricingFigures(),
    noKeywordStuffing(),
    notDuplicateOf(),
  ],
};

export default reputation;
