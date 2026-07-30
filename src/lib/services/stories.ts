import fs from 'fs'
import path from 'path'

import matter from 'gray-matter'

const STORIES_DIR = path.join(process.cwd(), 'content', 'stories')

export type StoryEntry = {
  slug: string;
  frontmatter: {
    title: string;
    description?: string;
    slug: string;
    tags: string[];
    locale: string;
    publishedAt: string;
    updatedAt?: string;
    draft: boolean;
    series?: string;
    seriesTitle?: string;
    seriesOrder?: number;
    sources: string[];
    faq: Array<{ q: string; a: string }>;
  };
};

export type StoryLocale = 'zh-TW' | 'en'

export type StoryDetailResult = {
  entry: StoryEntry;
  content: string;
};

export type StoryListResult =
  | { ok: true; stories: StoryEntry[] }
  | { ok: false; error: Error };

function parseStoryFile(slug: string): StoryDetailResult | null {
  const filePath = path.join(STORIES_DIR, `${slug}.mdx`)
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }

  const { data, content } = matter(raw)

  const entry: StoryEntry = {
    slug,
    frontmatter: {
      title: data.title ?? '',
      description: data.description,
      slug: data.slug ?? slug,
      tags: Array.isArray(data.tags) ? data.tags : [],
      locale: data.locale ?? 'zh-TW',
      publishedAt: data.publishedAt != null ? String(data.publishedAt) : '',
      updatedAt: data.updatedAt != null ? String(data.updatedAt) : undefined,
      draft: data.draft ?? false,
      series: data.series != null ? String(data.series) : undefined,
      seriesTitle: data.seriesTitle != null ? String(data.seriesTitle) : undefined,
      seriesOrder: typeof data.seriesOrder === 'number' ? data.seriesOrder : undefined,
      sources: Array.isArray(data.sources) ? data.sources : [],
      faq: Array.isArray(data.faq) ? data.faq : [],
    },
  }

  return { entry, content }
}

function storyListError(scope: string, error: unknown): StoryListResult {
  const normalizedError = error instanceof Error ? error : new Error(String(error))
  console.error(`[stories:${scope}] filesystem read failed`, normalizedError)
  return { ok: false, error: normalizedError }
}

/** Reads every published story for a locale. Throws on filesystem failure. */
function readPublishedEntries(locale: StoryLocale): StoryEntry[] {
  const files = fs.readdirSync(STORIES_DIR).filter(f => f.endsWith('.mdx'))

  return files
    .map(file => {
      const slug = file.replace(/\.mdx$/, '')
      const result = parseStoryFile(slug)
      return result?.entry ?? null
    })
    .filter((entry): entry is StoryEntry => entry !== null)
    .filter(
      entry => entry.frontmatter.locale === locale && !entry.frontmatter.draft,
    )
}

export async function getAllStories(
  locale: StoryLocale = 'zh-TW',
): Promise<StoryListResult> {
  try {
    const stories = readPublishedEntries(locale)

    // English editions are not authored yet (tracked separately). An empty `/en`
    // hub next to a populated zh-TW one reads as a broken surface, so `en` falls
    // back to the zh-TW set: readers translate the body themselves, and every
    // `/en/stories/*` URL canonicals back to its prefix-free zh-TW twin so the two
    // never compete as duplicate content. Once real English editions land they win
    // on their own — the fallback only fires when the `en` set is empty.
    if (locale === 'en' && stories.length === 0) {
      return { ok: true, stories: readPublishedEntries('zh-TW') }
    }

    return { ok: true, stories }
  } catch (error) {
    return storyListError('getAllStories', error)
  }
}

export async function getStoryBySlug(slug: string): Promise<StoryDetailResult | null> {
  try {
    return parseStoryFile(slug)
  } catch (error) {
    console.error(`[stories:getStoryBySlug] filesystem read failed`, error)
    return null
  }
}

export async function getPublishedStoryBySlug(
  slug: string,
  locale?: StoryLocale,
): Promise<StoryDetailResult | null> {
  const story = await getStoryBySlug(slug)
  if (!story || story.entry.frontmatter.draft) return null

  // `locale` is accepted but deliberately does NOT gate the lookup. It used to
  // (`if (locale && story.entry.frontmatter.locale !== locale) return null`), which
  // is what made every `/en/stories/<slug>` a 404 while the zh-TW twin rendered.
  // Until English editions exist, the English route serves the zh-TW document and
  // canonicals to the zh-TW URL (see `generateMetadata` in the detail route).
  // Restore the one-line gate above to re-split the locales.
  void locale

  return story
}

export async function getStoriesByTag(
  tag: string,
  locale: StoryLocale = 'zh-TW',
): Promise<StoryListResult> {
  try {
    const stories = readPublishedEntries(locale).filter(entry =>
      entry.frontmatter.tags.includes(tag),
    )

    return { ok: true, stories }
  } catch (error) {
    return storyListError('getStoriesByTag', error)
  }
}

export async function getStorySeries(
  seriesId: string,
  locale: StoryLocale = 'zh-TW',
): Promise<StoryListResult> {
  try {
    const stories = readPublishedEntries(locale)
      .filter(entry => entry.frontmatter.series === seriesId)
      .sort(
        (a, b) =>
          (a.frontmatter.seriesOrder ?? Number.MAX_SAFE_INTEGER) -
          (b.frontmatter.seriesOrder ?? Number.MAX_SAFE_INTEGER),
      )

    return { ok: true, stories }
  } catch (error) {
    return storyListError('getStorySeries', error)
  }
}
