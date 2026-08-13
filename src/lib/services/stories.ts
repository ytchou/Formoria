import fs from 'fs'
import path from 'path'

import { cache } from 'react'

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
    /** Byline. Defaults to the editorial team when a story omits it. */
    author?: string;
    /**
     * Absolute URL of the story's lead image. Doubles as the page's own
     * `og:image` / `twitter:image`, replacing the site-wide default card that
     * every other page shares — a share of a story should look like that
     * story. Absent means the default stays.
     *
     * The host must be on `ALLOWED_IMAGE_HOSTS`
     * (`src/lib/images/allowed-image-hosts.ts`), which backs the CSP `img-src`
     * allowlist; anything else is blocked by the browser at render time.
     */
    heroImage?: string;
    /**
     * Alt text for `heroImage`. Absent renders `alt=""` (decorative) rather
     * than echoing the `<h1>` a screen reader is about to read anyway.
     */
    heroImageAlt?: string;
    sources: string[];
    faq: Array<{ q: string; a: string }>;
    /**
     * Whether this story may be quoted as a voice exemplar by the drafting
     * skill (`.claude/skills/write-stories`). Editorial metadata only — nothing
     * in the rendered page reads it.
     *
     * It exists because the voice pack is derived from the published corpus,
     * and a corpus that treats every story as exemplary regresses toward its
     * own drift: one article that slips into 您 or a stray 破折號 teaches the
     * next one to do the same. Stories predating the voice rules stay `false`
     * and are still read for the drift report, just never quoted from.
     */
    voiceCanonical?: boolean;
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

export type SeriesGroup = {
  id: string;
  title: string;
  stories: StoryEntry[];
  totalCount: number;
};

/**
 * Normalizes an author-supplied frontmatter date to an ISO-8601 string.
 *
 * YAML parses an unquoted `2026-06-15` as a timestamp, so gray-matter can hand
 * back either a `Date` or a string depending on whether the author quoted it.
 * Both have to land as the same ISO string, because this value is rendered and
 * also emitted as schema.org `datePublished`. An unparseable value returns
 * undefined rather than throwing — the callers degrade by omitting the date.
 */
function toIsoDateString(value: unknown): string | undefined {
  if (value == null) return undefined
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
  }
  const raw = String(value)
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString()
}

/**
 * Reads and parses one MDX file. Cached per request: the detail route resolves
 * the same slug twice (`generateMetadata` and the page body both call
 * `getPublishedStoryBySlug`), and without this each render paid two full
 * read + gray-matter parses. Callers share one object graph — treat the
 * returned `entry` and `content` as read-only.
 */
const parseStoryFile = cache((slug: string): StoryDetailResult | null => {
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
      // An unquoted `publishedAt: 2026-06-15` is a YAML timestamp, so gray-matter
      // hands back a Date. `String()` on that yields a locale-formatted string that
      // is not a valid schema.org date, which then lands in the Article JSON-LD.
      publishedAt: toIsoDateString(data.publishedAt) ?? '',
      updatedAt: toIsoDateString(data.updatedAt),
      draft: data.draft ?? false,
      series: data.series != null ? String(data.series) : undefined,
      seriesTitle: data.seriesTitle != null ? String(data.seriesTitle) : undefined,
      seriesOrder: typeof data.seriesOrder === 'number' ? data.seriesOrder : undefined,
      author: data.author != null ? String(data.author) : undefined,
      heroImage: data.heroImage != null ? String(data.heroImage) : undefined,
      heroImageAlt: data.heroImageAlt != null ? String(data.heroImageAlt) : undefined,
      sources: Array.isArray(data.sources) ? data.sources : [],
      faq: Array.isArray(data.faq) ? data.faq : [],
      // Strict `=== true`, not `?? false`: a story that writes
      // `voiceCanonical: "true"` as a quoted string has a mistake worth leaving
      // visible as `false`, since coercing it would silently promote an
      // unreviewed story into the exemplar corpus.
      voiceCanonical: data.voiceCanonical === true,
    },
  }

  return { entry, content }
})

function storyListError(scope: string, error: unknown): StoryListResult {
  const normalizedError = error instanceof Error ? error : new Error(String(error))
  console.error(`[stories:${scope}] filesystem read failed`, normalizedError)
  return { ok: false, error: normalizedError }
}

/**
 * `publishedAt` is author-supplied frontmatter, so it can be absent or
 * unparseable. Those entries get -Infinity, which sinks them to the end of a
 * newest-first sort instead of throwing or landing wherever `readdirSync`
 * happened to put them.
 */
function publishedTimestamp(entry: StoryEntry): number {
  const parsed = Date.parse(entry.frontmatter.publishedAt)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

/**
 * Newest-first, with a slug tie-break so the order is fully deterministic —
 * two stories sharing a date (or both missing one) must not reorder between
 * builds. The `at !== bt` guard matters: subtracting two -Infinity values
 * yields NaN, which `Array.prototype.sort` treats as an arbitrary result.
 */
function compareByPublishedAtDesc(a: StoryEntry, b: StoryEntry): number {
  const at = publishedTimestamp(a)
  const bt = publishedTimestamp(b)
  if (at !== bt) return bt - at
  if (a.slug === b.slug) return 0
  return a.slug < b.slug ? -1 : 1
}

/**
 * The one series comparator. `getStorySeries` and `groupStoriesBySeries` both
 * use it — they used to carry byte-identical copies of the
 * `?? Number.MAX_SAFE_INTEGER` expression (one of them in the hub page), which
 * is exactly how the two orderings drift apart.
 *
 * Returns 0 for equal/absent orders on purpose: `Array.prototype.sort` is
 * stable, so members with no `seriesOrder` keep the newest-first order they
 * arrived in rather than getting a second, competing sort key.
 */
function compareBySeriesOrder(a: StoryEntry, b: StoryEntry): number {
  return (
    (a.frontmatter.seriesOrder ?? Number.MAX_SAFE_INTEGER) -
    (b.frontmatter.seriesOrder ?? Number.MAX_SAFE_INTEGER)
  )
}

/**
 * `updatedAt` is optional frontmatter — a story that has never been revised
 * only carries `publishedAt`, and falling back to it is what keeps a fresh
 * never-revised story ahead of an old one. An entry with neither parseable
 * date sinks to the end rather than landing wherever `readdirSync` put it.
 */
function updatedTimestamp(entry: StoryEntry): number {
  const parsed = Date.parse(
    entry.frontmatter.updatedAt || entry.frontmatter.publishedAt,
  )
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

/**
 * Most-recently-touched first, with the same slug tie-break as
 * `compareByPublishedAtDesc` so the order is fully deterministic between
 * builds. The `at !== bt` guard is load-bearing for the same reason it is
 * there: subtracting two -Infinity values yields NaN, which `sort` treats as
 * an arbitrary result.
 */
function compareByUpdatedAtDesc(a: StoryEntry, b: StoryEntry): number {
  const at = updatedTimestamp(a)
  const bt = updatedTimestamp(b)
  if (at !== bt) return bt - at
  if (a.slug === b.slug) return 0
  return a.slug < b.slug ? -1 : 1
}

/**
 * Reads + parses every file in the stories directory, once per request.
 * Throws on filesystem failure so the list wrappers can report `ok: false`.
 */
const readAllEntries = cache((): StoryEntry[] => {
  const files = fs.readdirSync(STORIES_DIR).filter(file => file.endsWith('.mdx'))

  return files
    .map(file => parseStoryFile(file.replace(/\.mdx$/, ''))?.entry ?? null)
    .filter((entry): entry is StoryEntry => entry !== null)
})

/** Published (non-draft) entries authored in `locale`, newest-first. */
const readPublishedEntries = cache((locale: StoryLocale): StoryEntry[] =>
  readAllEntries()
    .filter(entry => entry.frontmatter.locale === locale && !entry.frontmatter.draft)
    .sort(compareByPublishedAtDesc),
)

/**
 * The single locale-resolution step. Every list query goes through this — when
 * only `getAllStories` carried the fallback, `/en/stories` rendered the zh-TW
 * set with a full tag chip bar, and clicking any chip called
 * `getStoriesByTag(tag, 'en')`, got `[]`, and showed "coming soon" on a hub
 * that visibly had stories. Every filter was a dead end.
 *
 * English editions are not authored yet (tracked separately). An empty `/en`
 * hub next to a populated zh-TW one reads as a broken surface, so `en` falls
 * back to the zh-TW set: readers translate the body themselves, and every
 * `/en/stories/*` URL canonicals back to its prefix-free zh-TW twin so the two
 * never compete as duplicate content. Once real English editions land they win
 * on their own — the fallback only fires when the `en` set is empty.
 */
const resolvePublishedEntries = cache((locale: StoryLocale): StoryEntry[] => {
  const entries = readPublishedEntries(locale)
  if (locale === 'en' && entries.length === 0) return readPublishedEntries('zh-TW')
  return entries
})

export async function getAllStories(
  locale: StoryLocale = 'zh-TW',
): Promise<StoryListResult> {
  try {
    return { ok: true, stories: resolvePublishedEntries(locale) }
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
    const stories = resolvePublishedEntries(locale).filter(entry =>
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
    const stories = resolvePublishedEntries(locale)
      .filter(entry => entry.frontmatter.series === seriesId)
      .sort(compareBySeriesOrder)

    return { ok: true, stories }
  } catch (error) {
    return storyListError('getStorySeries', error)
  }
}

/**
 * The same series as `getStorySeries`, ordered most-recently-updated first
 * rather than in authored order.
 *
 * Two callers, two questions. `/stories/[slug]`'s series navigation asks "what
 * is part 3 of this series", so it must stay in `seriesOrder`. The event page
 * asks "what is newest about this event", where a part 1 revised yesterday
 * outranks a part 4 published last month. Separate function rather than a flag
 * on `getStorySeries`, so neither caller can silently acquire the other's
 * ordering.
 */
export async function getStorySeriesByRecency(
  seriesId: string,
  locale: StoryLocale = 'zh-TW',
): Promise<StoryListResult> {
  try {
    const stories = resolvePublishedEntries(locale)
      .filter(entry => entry.frontmatter.series === seriesId)
      .sort(compareByUpdatedAtDesc)

    return { ok: true, stories }
  } catch (error) {
    return storyListError('getStorySeriesByRecency', error)
  }
}

/**
 * Splits a story list into series groups (rendered first, as titled sections)
 * and the remaining standalone entries. Group order follows first appearance
 * in `entries`; members are ordered by the shared `compareBySeriesOrder`.
 *
 * `totalCount` is the size of the *whole* published series for `locale`,
 * resolved from the full set rather than from `entries`. On a tag-filtered hub
 * `entries` holds only the matching members, so counting them would make a
 * five-part series announce itself as "2 parts"; callers pair `stories.length`
 * with `totalCount` to say "2 of 5" instead.
 *
 * Lives here, not in the hub page: the page owns layout and data fetching, and
 * this is the same partition + ordering logic `getStorySeries` already encodes.
 */
export function groupStoriesBySeries(
  entries: StoryEntry[],
  locale: StoryLocale = 'zh-TW',
): { series: SeriesGroup[]; standalone: StoryEntry[] } {
  const groups = new Map<string, SeriesGroup>()
  const standalone: StoryEntry[] = []

  for (const entry of entries) {
    const seriesId = entry.frontmatter.series
    if (!seriesId) {
      standalone.push(entry)
      continue
    }

    const existing = groups.get(seriesId)
    if (existing) {
      existing.stories.push(entry)
    } else {
      groups.set(seriesId, { id: seriesId, title: seriesId, stories: [entry], totalCount: 0 })
    }
  }

  if (groups.size === 0) return { series: [], standalone }

  // A filesystem failure while resolving true series sizes must not take down a
  // hub that already has its list in hand — degrade to counting what we were
  // given. Cached, so on the common path this re-reads nothing.
  let totals: Map<string, number>
  try {
    totals = countBySeries(resolvePublishedEntries(locale))
  } catch (error) {
    console.error('[stories:groupStoriesBySeries] series total lookup failed', error)
    totals = countBySeries(entries)
  }

  for (const group of groups.values()) {
    group.stories.sort(compareBySeriesOrder)
    // Title comes from the earliest member that declares one, so the section
    // heading stays stable even if a later part omits `seriesTitle`.
    group.title =
      group.stories.find(entry => entry.frontmatter.seriesTitle)?.frontmatter.seriesTitle ??
      group.id
    group.totalCount = totals.get(group.id) ?? group.stories.length
  }

  return { series: [...groups.values()], standalone }
}

function countBySeries(entries: StoryEntry[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const seriesId = entry.frontmatter.series
    if (seriesId) counts.set(seriesId, (counts.get(seriesId) ?? 0) + 1)
  }
  return counts
}
