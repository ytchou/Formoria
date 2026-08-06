/**
 * Keyword ownership registry enums (DEV-1354).
 *
 * Split out of `keyword-map.ts` deliberately: this module is dependency-free, so
 * pure consumers (`search-console/segmentation.ts`, and later any route or
 * component) can name a page type without dragging `node:fs`, `node:path`,
 * `yaml` and `zod` onto their import graph. The plan's performance budget
 * requires that `yaml` never reach the client bundle; keeping the enums here is
 * the boundary that enforces it rather than a comment asking for it.
 *
 * `keyword-map.ts` re-exports everything below, so existing imports keep working.
 *
 * Several exports here are currently unused outside tests — that is deliberate.
 * They are the design surface Ticket B (the `/categories/[l1]/[l2]` routes)
 * consumes; knip flags them and the repo baseline is already red, so do not
 * delete them to satisfy the report.
 */

export const SEARCH_INTENTS = [
  'navigational',
  'informational',
  'commercial',
  'transactional',
] as const

export const PAGE_TYPES = [
  'homepage',
  'directory',
  'l1-category',
  'l2-category',
  'topic-hub',
  'story',
  'glossary',
  'stats',
  'brand-detail',
] as const

export const TARGET_STATUSES = ['live', 'proposed', 'pending'] as const
export const DATA_QUALITIES = ['pass', 'thin'] as const
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const
export const ELIGIBILITIES = [
  'launch',
  'defer-brands',
  'defer-data',
  'defer-overlap',
  'defer-no-demand',
  'reject-taxonomy',
] as const
export const COMPOSITES = ['none', 'synonym', 'multi-intent'] as const
export const INDEXABILITIES = ['index', 'noindex'] as const
export const LOCALES = ['zh-TW', 'en'] as const

export type SearchIntent = (typeof SEARCH_INTENTS)[number]
export type PageType = (typeof PAGE_TYPES)[number]
export type TargetStatus = (typeof TARGET_STATUSES)[number]
export type DataQuality = (typeof DATA_QUALITIES)[number]
export type Priority = (typeof PRIORITIES)[number]
export type Eligibility = (typeof ELIGIBILITIES)[number]
export type Composite = (typeof COMPOSITES)[number]
export type Indexability = (typeof INDEXABILITIES)[number]
export type KeywordMapLocale = (typeof LOCALES)[number]
