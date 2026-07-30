import fs from 'fs'
import path from 'path'

import matter from 'gray-matter'

const STORIES_DIR = path.join(process.cwd(), 'content', 'stories')

type StoryEntry = {
  slug: string;
  frontmatter: {
    title: string;
    description?: string;
    slug: string;
    category?: string;
    locale: string;
    publishedAt: string;
    updatedAt?: string;
    draft: boolean;
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
      category: data.category,
      locale: data.locale ?? 'zh-TW',
      publishedAt: data.publishedAt != null ? String(data.publishedAt) : '',
      updatedAt: data.updatedAt != null ? String(data.updatedAt) : undefined,
      draft: data.draft ?? false,
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

export async function getAllStories(
  locale: StoryLocale = 'zh-TW',
): Promise<StoryListResult> {
  try {
    const files = fs.readdirSync(STORIES_DIR).filter(f => f.endsWith('.mdx'))

    const stories = files
      .map(file => {
        const slug = file.replace(/\.mdx$/, '')
        const result = parseStoryFile(slug)
        return result?.entry ?? null
      })
      .filter((entry): entry is StoryEntry => entry !== null)
      .filter(
        entry => entry.frontmatter.locale === locale && !entry.frontmatter.draft,
      )

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
  if (locale && story.entry.frontmatter.locale !== locale) return null
  return story
}

export async function getStoriesByCategory(
  category: string,
  locale: StoryLocale = 'zh-TW',
): Promise<StoryListResult> {
  try {
    const files = fs.readdirSync(STORIES_DIR).filter(f => f.endsWith('.mdx'))

    const stories = files
      .map(file => {
        const slug = file.replace(/\.mdx$/, '')
        const result = parseStoryFile(slug)
        return result?.entry ?? null
      })
      .filter((entry): entry is StoryEntry => entry !== null)
      .filter(
        entry =>
          entry.frontmatter.locale === locale &&
          !entry.frontmatter.draft &&
          entry.frontmatter.category === category,
      )

    return { ok: true, stories }
  } catch (error) {
    return storyListError('getStoriesByCategory', error)
  }
}
