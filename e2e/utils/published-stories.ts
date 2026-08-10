import fs from 'fs';
import path from 'path';

import matter from 'gray-matter';

/**
 * Editorial content lives in the repo, not the database, so the specs that need a
 * real story can read the same directory the service does and gate themselves on
 * it. The surface ships with `content/stories/` empty (only `.gitkeep`), so those
 * specs skip; the first story merged un-skips them with no spec edit.
 *
 * Mirrors the published filter in `src/lib/services/stories.ts`: `.mdx` only,
 * `draft: false`, matching authored locale.
 */
export type PublishedStory = {
  /** Filename stem — what `/stories/[slug]` resolves against. */
  slug: string;
  /** Frontmatter slug — used for the canonical URL, may diverge from `slug`. */
  canonicalSlug: string;
  title: string;
  locale: string;
  /**
   * MDX body, so a spec can pin the story that actually exercises the component it
   * names instead of hoping the first story on disk embeds one. Reading the body is
   * the only way to know: `<BrandCard>` is a body element, not frontmatter.
   */
  body: string;
  /** `faq` frontmatter, which FaqBlock renders. Optional by design. */
  hasFaq: boolean;
};

const STORIES_DIR = path.join(process.cwd(), 'content', 'stories');

export function publishedStories(locale = 'zh-TW'): PublishedStory[] {
  let files: string[];
  try {
    files = fs.readdirSync(STORIES_DIR).filter((f) => f.endsWith('.mdx'));
  } catch {
    return [];
  }

  return files.flatMap((file) => {
    const slug = file.replace(/\.mdx$/, '');
    const { data, content } = matter(
      fs.readFileSync(path.join(STORIES_DIR, file), 'utf8'),
    );
    if (data.draft === true) return [];
    const authoredLocale = data.locale ?? 'zh-TW';
    if (authoredLocale !== locale) return [];
    return [
      {
        slug,
        canonicalSlug: data.slug ?? slug,
        title: data.title ?? '',
        locale: authoredLocale,
        body: content,
        hasFaq: Array.isArray(data.faq) && data.faq.length > 0,
      },
    ];
  });
}

/** Reason string shared by every content-gated skip, so reports read consistently. */
export const NO_PUBLISHED_STORIES = 'no published stories in content/stories';
