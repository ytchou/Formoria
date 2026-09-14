import {
  noKeywordStuffing,
  noCommerceClaims,
  notDuplicateOf,
  pureLanguage,
  withinLengthBand,
} from "./validators";
import { CUSTOM_QUESTION_CEILING, type FaqPreset } from "./types";

const custom: FaqPreset = {
  id: "custom",
  eligible: () => true,
  requiredEvidence: [],
  render: null,
  promptFragment: {
    prompt: "faq-custom",
    variables: (ctx) => ({
      brand_name: ctx.brand.name,
      ceiling: String(CUSTOM_QUESTION_CEILING),
    }),
  },
  validators: [
    pureLanguage(),
    withinLengthBand(),
    // A custom question is the easiest place for an NT$ figure to slip in,
    // because its topic is unconstrained. The rule is stated once in the
    // shared preamble and enforced here for every model-authored preset.
    noCommerceClaims(),
    noKeywordStuffing(),
    notDuplicateOf(),
  ],
};

export default custom;
