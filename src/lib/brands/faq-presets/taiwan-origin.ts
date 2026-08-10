import { hasValue, type FaqPreset } from "./types";

const taiwanOrigin: FaqPreset = {
  id: "taiwan-origin",
  // The template floor is code-derived from an actual MIT registry match;
  // declarations and brands without a submitted status must not be presented
  // as verified manufacturing evidence.
  eligible: (ctx) => ctx.brand.mitStatus === "verified",
  requiredEvidence: [],
  render: {
    questionKey: "brandFaq.isMadeInTaiwan.question",
    templateFloor: (ctx, t) => {
      const verifiedAnswer = t("brandFaq.isMadeInTaiwan.answer", {
        brandName: ctx.brand.name,
      });
      const registrySource = t("brandFaq.isMadeInTaiwan.registrySource");
      return hasValue(ctx.brand.mitStory)
        ? `${ctx.brand.mitStory}\n\n${verifiedAnswer} ${registrySource}`
        : `${verifiedAnswer} ${registrySource}`;
    },
  },
  // MIT copy is code-derived and must never be model-authored.
  promptFragment: null,
  validators: [],
};

export default taiwanOrigin;
