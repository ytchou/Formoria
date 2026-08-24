import {
  noKeywordStuffing,
  noCommerceClaims,
  notDuplicateOf,
  pureLanguage,
  withinLengthBand,
} from "./validators";
import { CUSTOM_QUESTION_CEILING, type FaqPreset } from "./types";
import { faqCustomPrompt } from "@/lib/prompts";

const custom: FaqPreset = {
  id: "custom",
  eligible: () => true,
  requiredEvidence: [],
  render: null,
  promptFragment: (ctx) =>
    faqCustomPrompt(ctx.brand.name, CUSTOM_QUESTION_CEILING),
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
