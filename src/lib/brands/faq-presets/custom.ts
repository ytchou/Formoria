import {
  noKeywordStuffing,
  noPricingFigures,
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
  promptFragment: (ctx) =>
    `可依品牌「${ctx.brand.name}」資料自行選擇最多 ${CUSTOM_QUESTION_CEILING} 個最有用的自訂問題；回傳零個也完全有效，寧可少，不可湊數。每個回答都必須有依據，且不可重述既有問題。`,
  validators: [
    pureLanguage(),
    withinLengthBand(),
    // A custom question is the easiest place for an NT$ figure to slip in,
    // because its topic is unconstrained. The rule is stated once in the
    // shared preamble and enforced here for every model-authored preset.
    noPricingFigures(),
    noKeywordStuffing(),
    notDuplicateOf(),
  ],
};

export default custom;
