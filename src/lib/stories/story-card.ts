/**
 * The fields a story card actually renders (DEV-1972).
 *
 * Every prop handed to a client component is serialized into the page's inline
 * RSC payload, so passing a whole `StoryEntry` ships its FAQ, sources, brand
 * list, and editorial metadata in the HTML. Cards receive only what they
 * render. Keep this module a leaf — type-only imports — because a "use client"
 * component imports its types.
 */
import type { StoryEntry } from "@/lib/services/stories";

export type StoryCardEntry = {
  slug: string;
  frontmatter: Pick<
    StoryEntry["frontmatter"],
    | "title"
    | "description"
    | "heroImage"
    | "heroImageAlt"
    | "publishedAt"
    | "tags"
  >;
};

/** Optional keys are omitted, not set to `undefined`, so the payload carries no `$undefined`. */
export function toStoryCard(story: StoryEntry): StoryCardEntry {
  const { title, description, heroImage, heroImageAlt, publishedAt, tags } =
    story.frontmatter;
  return {
    slug: story.slug,
    frontmatter: {
      title,
      ...(description === undefined ? {} : { description }),
      ...(heroImage === undefined ? {} : { heroImage }),
      ...(heroImageAlt === undefined ? {} : { heroImageAlt }),
      publishedAt,
      tags,
    },
  };
}
