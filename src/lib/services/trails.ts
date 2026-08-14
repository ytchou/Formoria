import fs from 'fs'
import path from 'path'

import { cache } from 'react'
import matter from 'gray-matter'

const TRAILS_DIR = path.join(process.cwd(), 'content', 'trails')

export type TrailSection = {
  key: string
  title: string
}

/**
 * A trail deliberately mirrors StoryEntry and adds only trail-specific
 * governance and relationship fields. Keeping the shape parallel lets the
 * existing story list row and MDX element map serve both editorial surfaces.
 */
export type TrailEntry = {
  slug: string
  frontmatter: {
    title: string
    description?: string
    slug: string
    tags: string[]
    locale: string
    publishedAt: string
    updatedAt?: string
    draft: boolean
    series?: string
    seriesTitle?: string
    seriesOrder?: number
    author?: string
    heroImage?: string
    heroImageAlt?: string
    sources: string[]
    faq: Array<{ q: string; a: string }>
    voiceCanonical?: boolean
    promise?: string
    readerSituation?: string
    sections: TrailSection[]
    exclusions?: string
    editorialOwner?: string
    reviewedAt?: string
    reviewDueAt?: string
    relatedCategories: string[]
    relatedStories: string[]
    relatedTrails: string[]
  }
}

export type TrailLocale = 'zh-TW' | 'en'

export type TrailDetailResult = {
  entry: TrailEntry
  content: string
}

export type TrailListResult =
  | { ok: true; trails: TrailEntry[] }
  | { ok: false; error: Error }

function toIsoDateString(value: unknown): string | undefined {
  if (value == null) return undefined
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
  }
  const raw = String(value)
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString()
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function sectionsArray(value: unknown): TrailSection[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      key: typeof item.key === 'string' ? item.key : '',
      title: typeof item.title === 'string' ? item.title : '',
    }))
}

function faqArray(value: unknown): Array<{ q: string; a: string }> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      q: typeof item.q === 'string' ? item.q : '',
      a: typeof item.a === 'string' ? item.a : '',
    }))
}

function optionalString(value: unknown): string | undefined {
  return value == null ? undefined : String(value)
}

/** Reads one MDX document and degrades malformed files to safe defaults. */
const parseTrailFile = cache((slug: string): TrailDetailResult | null => {
  const filePath = path.join(TRAILS_DIR, `${slug}.mdx`)
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }

  let data: Record<string, unknown>
  let content: string
  try {
    const parsed = matter(raw)
    data = parsed.data as Record<string, unknown>
    content = parsed.content
  } catch {
    data = {}
    content = raw
  }

  const entry: TrailEntry = {
    slug,
    frontmatter: {
      title: typeof data.title === 'string' ? data.title : '',
      description: optionalString(data.description),
      slug: typeof data.slug === 'string' ? data.slug : slug,
      tags: stringArray(data.tags),
      locale: typeof data.locale === 'string' ? data.locale : 'zh-TW',
      publishedAt: toIsoDateString(data.publishedAt) ?? '',
      updatedAt: toIsoDateString(data.updatedAt),
      draft: data.draft === true,
      series: optionalString(data.series),
      seriesTitle: optionalString(data.seriesTitle),
      seriesOrder: typeof data.seriesOrder === 'number' ? data.seriesOrder : undefined,
      author: optionalString(data.author),
      heroImage: optionalString(data.heroImage),
      heroImageAlt: optionalString(data.heroImageAlt),
      sources: stringArray(data.sources),
      faq: faqArray(data.faq),
      voiceCanonical: data.voiceCanonical === true,
      promise: optionalString(data.promise),
      readerSituation: optionalString(data.readerSituation),
      sections: sectionsArray(data.sections),
      exclusions: optionalString(data.exclusions),
      editorialOwner: optionalString(data.editorialOwner),
      reviewedAt: toIsoDateString(data.reviewedAt),
      reviewDueAt: toIsoDateString(data.reviewDueAt),
      relatedCategories: stringArray(data.relatedCategories),
      relatedStories: stringArray(data.relatedStories),
      relatedTrails: stringArray(data.relatedTrails),
    },
  }

  return { entry, content }
})

function trailListError(scope: string, error: unknown): TrailListResult {
  const normalizedError = error instanceof Error ? error : new Error(String(error))
  console.error(`[trails:${scope}] filesystem read failed`, normalizedError)
  return { ok: false, error: normalizedError }
}

function publishedTimestamp(entry: TrailEntry): number {
  const parsed = Date.parse(entry.frontmatter.publishedAt)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

function compareByPublishedAtDesc(a: TrailEntry, b: TrailEntry): number {
  const at = publishedTimestamp(a)
  const bt = publishedTimestamp(b)
  if (at !== bt) return bt - at
  if (a.slug === b.slug) return 0
  return a.slug < b.slug ? -1 : 1
}

const readAllEntries = cache((): TrailEntry[] => {
  const files = fs.readdirSync(TRAILS_DIR).filter((file) => file.endsWith('.mdx'))
  return files
    .map((file) => parseTrailFile(file.replace(/\.mdx$/, ''))?.entry ?? null)
    .filter((entry): entry is TrailEntry => entry !== null)
})

const readPublishedEntries = cache((locale: TrailLocale): TrailEntry[] =>
  readAllEntries()
    .filter((entry) => entry.frontmatter.locale === locale && !entry.frontmatter.draft)
    .sort(compareByPublishedAtDesc),
)

const resolvePublishedEntries = cache((locale: TrailLocale): TrailEntry[] => {
  const entries = readPublishedEntries(locale)
  if (locale === 'en' && entries.length === 0) return readPublishedEntries('zh-TW')
  return entries
})

export const getTrailBySlug = cache(
  async (slug: string): Promise<TrailDetailResult | null> => {
    try {
      return parseTrailFile(slug)
    } catch (error) {
      console.error('[trails:getTrailBySlug] filesystem read failed', error)
      return null
    }
  },
)

export const getPublishedTrailBySlug = cache(
  async (slug: string, locale?: TrailLocale): Promise<TrailDetailResult | null> => {
    const trail = await getTrailBySlug(slug)
    if (!trail || trail.entry.frontmatter.draft) return null
    void locale
    return trail
  },
)

export const getAllTrails = cache(
  async (locale: TrailLocale = 'zh-TW'): Promise<TrailListResult> => {
    try {
      return { ok: true, trails: resolvePublishedEntries(locale) }
    } catch (error) {
      return trailListError('getAllTrails', error)
    }
  },
)
