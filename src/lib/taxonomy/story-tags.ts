import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";

/**
 * Editorial tags live alongside the L1 category vocabulary on the same axis.
 * They describe what a story *is* rather than what it is *about* — an expo
 * report is `event`, with `creative-expo` identifying the specific expo and
 * category tags such as `crafts` describing its subject matter.
 */
export const STORY_EDITORIAL_TAGS = ["event", "creative-expo"] as const;

/**
 * The full story tag vocabulary: every L1 category slug plus the editorial
 * tags. Derived from `L1_CATEGORIES` rather than restated, so the
 * story axis can never drift from the brand taxonomy.
 */
export const STORY_TAGS: readonly string[] = [
  ...L1_CATEGORIES.map((category) => category.slug),
  ...STORY_EDITORIAL_TAGS,
];

export function isStoryTag(value: string): boolean {
  return STORY_TAGS.includes(value);
}
