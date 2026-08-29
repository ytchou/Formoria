import { buildBrandContextSuffix, type FaqPreset } from "./types";
import {
  noKeywordStuffing,
  noCommerceClaims,
  notDuplicateOf,
  pureLanguage,
  withinLengthBand,
} from "./validators";
import { faqMaterialsPrompt } from "@/lib/prompts";

const materials: FaqPreset = {
  id: "materials",
  eligible: (ctx) => (ctx.brand.material?.length ?? 0) > 0,
  requiredEvidence: ["material"],
  render: {
    questionKey: "brandFaq.materials.question",
    templateFloor: (ctx, t) => {
      const materialList = (ctx.brand.material ?? []).join(
        t("brandFaq.listSeparator"),
      );
      return t("brandFaq.materials.answer", {
        brandName: ctx.brand.name,
        materials: materialList,
        context: buildBrandContextSuffix(ctx, t),
      });
    },
  },
  promptFragment: (ctx) => faqMaterialsPrompt(ctx.brand.name),
  // `groundedIn(requiredEvidence)` is derived in the registry (index.ts).
  validators: [
    pureLanguage(),
    withinLengthBand(),
    noCommerceClaims(),
    noKeywordStuffing(),
    notDuplicateOf(),
  ],
};

export default materials;
