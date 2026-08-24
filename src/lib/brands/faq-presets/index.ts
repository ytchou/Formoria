import { createHash } from "node:crypto";
import { FAQ_PROMPT_PREAMBLE } from "@/lib/prompts";
import categoryPosition from "./category-position";
import custom from "./custom";
import mainProducts from "./main-products";
import reputation from "./reputation";
import taiwanOrigin from "./taiwan-origin";
import {
  CUSTOM_QUESTION_CEILING,
  type FaqBrandContext,
  type FaqPreset,
} from "./types";
import { groundedIn } from "./validators";

/**
 * `requiredEvidence` was previously documentation that nothing read, with each
 * preset separately hand-writing the same list into its own `groundedIn(...)`.
 * Deriving the validator from the declaration here means the contract a preset
 * *declares* and the one that is *enforced* cannot drift apart.
 */
function withDerivedValidators(preset: FaqPreset): FaqPreset {
  if (preset.requiredEvidence.length === 0) return preset;
  return {
    ...preset,
    validators: [groundedIn(preset.requiredEvidence), ...preset.validators],
  };
}

export const FAQ_PRESETS: readonly FaqPreset[] = [
  taiwanOrigin,
  categoryPosition,
  mainProducts,
  reputation,
  custom,
].map(withDerivedValidators);

/**
 * Can the model author this preset for this brand? Distinct from
 * `preset.eligible`, which asks only whether the template floor can render
 * from request-time evidence. Presets that need nothing extra share one
 * predicate. `category-position` overrides it because its prompt needs peer
 * stats the request path never loads.
 */
function isFaqPresetAuthorable(
  preset: FaqPreset,
  ctx: FaqBrandContext,
): boolean {
  return preset.authorable ? preset.authorable(ctx) : preset.eligible(ctx);
}

/** The authorable set — this is the enrichment phase's filter, not the render one. */
export function eligibleFaqPresets(ctx: FaqBrandContext): FaqPreset[] {
  return FAQ_PRESETS.filter((preset) => isFaqPresetAuthorable(preset, ctx));
}

export { FAQ_PROMPT_PREAMBLE } from "@/lib/prompts";

const FAQ_CUSTOM_LIMIT_PROMPT = `Custom questions: at most ${CUSTOM_QUESTION_CEILING}; zero is valid.`;

function orderedContributors(presets: readonly FaqPreset[]): FaqPreset[] {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  return FAQ_PRESETS.flatMap((preset) => {
    const passed = byId.get(preset.id);
    return passed ? [passed] : [];
  });
}

export function buildFaqSystemPrompt(
  presets: readonly FaqPreset[],
  ctx: FaqBrandContext,
): string {
  const fragments = orderedContributors(presets)
    .filter((preset) => preset.promptFragment !== null)
    .map((preset) => preset.promptFragment?.(ctx) ?? "")
    .filter(Boolean);

  return [FAQ_PROMPT_PREAMBLE, FAQ_CUSTOM_LIMIT_PROMPT, ...fragments].join("\n\n");
}

export function buildFaqPromptHash(presets: readonly FaqPreset[]): string {
  const fragmentIds = presets
    .filter((preset) => preset.promptFragment !== null)
    .map((preset) => preset.id)
    .sort();

  // Hash the stable preamble and contributing preset IDs, never the rendered
  // brand-specific prompt, so equivalent eligible sets share one prompt version.
  return createHash("sha256")
    .update([FAQ_PROMPT_PREAMBLE, FAQ_CUSTOM_LIMIT_PROMPT, ...fragmentIds].join("\n"))
    .digest("hex")
    .slice(0, 12);
}

export * from "./types";
export * from "./validators";
