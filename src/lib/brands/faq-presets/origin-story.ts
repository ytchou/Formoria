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
  // DEV-1994: no template floor. The only one it had restated the founding
  // year and city, which the brand page's metadata line already shows. The
  // preset stays registered so stored human-authored rows still render through
  // `getBrandFaq` (model rows for it are skipped there and never persisted).
  render: null,
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
