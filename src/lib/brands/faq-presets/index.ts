import categoryPosition from "./category-position";
import custom from "./custom";
import mainProducts from "./main-products";
import originStory from "./origin-story";
import whereToBuy from "./where-to-buy";
import {
  CUSTOM_QUESTION_CEILING,
  type FaqBrandContext,
  type FaqPreset,
} from "./types";
import { groundedIn, notGeneric } from "./validators";
import type { PromptName } from "@/lib/langfuse/prompt";

/**
 * `requiredEvidence` was previously documentation that nothing read, with each
 * preset separately hand-writing the same list into its own `groundedIn(...)`.
 * Deriving the validator from the declaration here means the contract a preset
 * *declares* and the one that is *enforced* cannot drift apart.
 */
function withDerivedValidators(preset: FaqPreset): FaqPreset {
  const validators = preset.id === "custom"
    ? [...preset.validators]
    : [...preset.validators, notGeneric()];
  if (preset.requiredEvidence.length === 0) return { ...preset, validators };
  return {
    ...preset,
    validators: [groundedIn(preset.requiredEvidence), ...validators],
  };
}

export const FAQ_PRESETS: readonly FaqPreset[] = [
  categoryPosition,
  mainProducts,
  whereToBuy,
  originStory,
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

const FAQ_CUSTOM_LIMIT_PROMPT = `Custom questions: at most ${CUSTOM_QUESTION_CEILING}; zero is valid.`;

function orderedContributors(presets: readonly FaqPreset[]): FaqPreset[] {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  return FAQ_PRESETS.flatMap((preset) => {
    const passed = byId.get(preset.id);
    return passed ? [passed] : [];
  });
}

/** Resolves one fragment's text; production passes `fetchLangfusePrompt`. */
export type FaqFragmentResolver = (
  prompt: PromptName,
  variables: Record<string, string>,
) => Promise<string>;

/**
 * The fragment fetch is injected rather than imported: this registry is
 * reachable from a client component through `types/enriched-data`, so the
 * Langfuse client cannot live here, and the injection also lets the preset
 * suite assemble a real prompt from the snapshot without a network mock.
 */
export async function buildFaqSystemPrompt(
  preamble: string,
  presets: readonly FaqPreset[],
  ctx: FaqBrandContext,
  resolve: FaqFragmentResolver,
): Promise<string> {
  const fragments = await Promise.all(
    orderedContributors(presets)
      .flatMap((preset) =>
        preset.promptFragment ? [preset.promptFragment] : [],
      )
      .map((fragment) => resolve(fragment.prompt, fragment.variables(ctx))),
  );

  return [preamble, FAQ_CUSTOM_LIMIT_PROMPT, ...fragments.filter(Boolean)].join(
    "\n\n",
  );
}

export * from "./types";
export * from "./validators";
