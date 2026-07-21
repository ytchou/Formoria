import fs from 'fs'
import path from 'path'

import matter from 'gray-matter'

const GUIDES_DIR = path.join(process.cwd(), 'content', 'guides')

export type GuideEntry = {
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

export type GuideDetailResult = {
  entry: GuideEntry;
  content: string;
};

export type GuideListResult =
  | { ok: true; guides: GuideEntry[] }
  | { ok: false; error: Error };

function parseGuideFile(slug: string): GuideDetailResult | null {
  const filePath = path.join(GUIDES_DIR, `${slug}.mdx`)
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }

  const { data, content } = matter(raw)

  const entry: GuideEntry = {
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

function guideListError(scope: string, error: unknown): GuideListResult {
  const normalizedError = error instanceof Error ? error : new Error(String(error))
  console.error(`[guides:${scope}] filesystem read failed`, normalizedError)
  return { ok: false, error: normalizedError }
}

export async function getAllGuides(): Promise<GuideListResult> {
  try {
    const files = fs.readdirSync(GUIDES_DIR).filter(f => f.endsWith('.mdx'))

    const guides = files
      .map(file => {
        const slug = file.replace(/\.mdx$/, '')
        const result = parseGuideFile(slug)
        return result?.entry ?? null
      })
      .filter((entry): entry is GuideEntry => entry !== null)
      .filter(
        entry => entry.frontmatter.locale === 'zh-TW' && !entry.frontmatter.draft,
      )

    return { ok: true, guides }
  } catch (error) {
    return guideListError('getAllGuides', error)
  }
}

export async function getGuideBySlug(slug: string): Promise<GuideDetailResult | null> {
  try {
    return parseGuideFile(slug)
  } catch (error) {
    console.error(`[guides:getGuideBySlug] filesystem read failed`, error)
    return null
  }
}

export async function getPublishedGuideBySlug(
  slug: string,
): Promise<GuideDetailResult | null> {
  const guide = await getGuideBySlug(slug)
  return guide?.entry.frontmatter.draft ? null : guide
}

export async function getGuidesByCategory(category: string): Promise<GuideListResult> {
  try {
    const files = fs.readdirSync(GUIDES_DIR).filter(f => f.endsWith('.mdx'))

    const guides = files
      .map(file => {
        const slug = file.replace(/\.mdx$/, '')
        const result = parseGuideFile(slug)
        return result?.entry ?? null
      })
      .filter((entry): entry is GuideEntry => entry !== null)
      .filter(
        entry =>
          entry.frontmatter.locale === 'zh-TW' &&
          !entry.frontmatter.draft &&
          entry.frontmatter.category === category,
      )

    return { ok: true, guides }
  } catch (error) {
    return guideListError('getGuidesByCategory', error)
  }
}
