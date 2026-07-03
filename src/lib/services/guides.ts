import { promises as fs } from 'fs'
import matter from 'gray-matter'
import path from 'path'
import { z } from 'zod'
import { PRODUCT_TYPE_CATEGORIES } from '../taxonomy/ontology'

const categorySlugs = PRODUCT_TYPE_CATEGORIES.map(c => c.slug) as [string, ...string[]]

const dateField = z.union([z.string(), z.date()]).transform(v =>
  v instanceof Date ? v.toISOString().split('T')[0] : v,
)

const faqItemSchema = z.object({
  q: z.string(),
  a: z.string(),
})

export type FaqItem = z.infer<typeof faqItemSchema>

export const guideFrontmatterSchema = z.object({
  title: z.string(),
  description: z.string(),
  slug: z.string(),
  category: z.enum(categorySlugs),
  locale: z.literal('zh-TW'),
  publishedAt: dateField,
  updatedAt: dateField.optional(),
  sources: z.array(z.string()).optional(),
  faq: z.array(faqItemSchema).optional(),
})

export type GuideFrontmatter = z.infer<typeof guideFrontmatterSchema>
export type GuideEntry = {
  frontmatter: GuideFrontmatter
  slug: string
}
export type GuideWithContent = GuideEntry & { content: string }

const GUIDES_DIR = path.join(process.cwd(), 'content/guides')

async function readGuideFile(filePath: string): Promise<GuideWithContent | null> {
  const content = await fs.readFile(filePath, 'utf8')
  const parsed = matter(content)
  const result = guideFrontmatterSchema.safeParse(parsed.data)

  if (!result.success) {
    return null
  }

  return {
    slug: result.data.slug,
    frontmatter: result.data,
    content: parsed.content,
  }
}

export async function getAllGuides(contentDir = GUIDES_DIR): Promise<GuideEntry[]> {
  let files: string[] = []

  try {
    files = await fs.readdir(contentDir)
  } catch {
    return []
  }

  const guides = await Promise.all(
    files
      .filter(file => file.endsWith('.mdx'))
      .map(async file => readGuideFile(path.join(contentDir, file))),
  )

  return guides
    .filter((guide): guide is GuideWithContent => guide !== null)
    .sort(
      (a, b) =>
        new Date(b.frontmatter.publishedAt).getTime() -
        new Date(a.frontmatter.publishedAt).getTime(),
    )
    .map(({ frontmatter, slug }) => ({ frontmatter, slug }))
}

export async function getGuideBySlug(
  slug: string,
  contentDir = GUIDES_DIR,
): Promise<GuideWithContent | null> {
  try {
    const files = await fs.readdir(contentDir)
    const mdxFiles = files.filter(file => file.endsWith('.mdx'))

    for (const file of mdxFiles) {
      const fullPath = path.join(contentDir, file)
      const guide = await readGuideFile(fullPath)
      if (guide?.frontmatter.slug === slug) {
        return guide
      }
    }

    return null
  } catch {
    return null
  }
}

export async function getGuidesByCategory(
  category: GuideFrontmatter['category'],
  contentDir = GUIDES_DIR,
): Promise<GuideEntry[]> {
  const guides = await getAllGuides(contentDir)
  return guides.filter(guide => guide.frontmatter.category === category)
}
