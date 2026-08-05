import {
  buildBrandContextSuffix,
  hasValue,
  type FaqPreset,
} from "./types";

const taiwanOrigin: FaqPreset = {
  id: "taiwan-origin",
  // This flagship question is intentionally eligible for every approved brand,
  // including brands whose mit_status has not been submitted.
  eligible: () => true,
  requiredEvidence: [],
  render: {
    questionKey: "brandFaq.isMadeInTaiwan.question",
    templateFloor: (ctx, t) => {
      if (ctx.brand.mitStatus === "verified") {
        const verifiedAnswer = t("brandFaq.isMadeInTaiwan.answer", {
          brandName: ctx.brand.name,
        });
        const registrySource = t("brandFaq.isMadeInTaiwan.registrySource");
        return hasValue(ctx.brand.mitStory)
          ? `${ctx.brand.mitStory}\n\n${verifiedAnswer} ${registrySource}`
          : `${verifiedAnswer} ${registrySource}`;
      }

      if (ctx.brand.mitStatus === "declared") {
        const scope = ctx.brand.mitDeclaredScope
          ? t(`brandFaq.isMadeInTaiwan.scopeLabels.${ctx.brand.mitDeclaredScope}`)
          : t("brandFaq.isMadeInTaiwan.scopeLabels.unspecified");
        const declaration = t("brandFaq.isMadeInTaiwan.declaredAnswer", {
          brandName: ctx.brand.name,
          scope,
        });
        const story = hasValue(ctx.brand.mitStory)
          ? `\n\n${ctx.brand.mitStory}`
          : "";
        return `${declaration}${story}`;
      }

      // This is deliberately negative: the absence of a submitted status must
      // never be rendered as verification or as an implied verification.
      return t("brandFaq.taiwanOrigin.undeclaredAnswer", {
        brandName: ctx.brand.name,
        context: buildBrandContextSuffix(ctx, t),
      });
    },
  },
  // MIT copy is code-derived and must never be model-authored.
  promptFragment: null,
  validators: [],
};

export default taiwanOrigin;
