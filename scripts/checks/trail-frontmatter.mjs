/**
 * Guards the contract shared by the trail loader and the trail detail route.
 * The loader intentionally defaults malformed fields so one bad document does
 * not take down the page; this check keeps that graceful degradation visible
 * during editorial review instead of silently shipping it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import matter from 'gray-matter'

const TRAILS_DIR = 'content/trails'
const PUBLIC_DIR = 'public'
const FAQ_MIN = 4
const FAQ_MAX = 6
const LOCALES = new Set(['zh-TW', 'en'])
const L1_CATEGORIES = new Set([
  'fashion',
  'bags-accessories',
  'jewelry',
  'beauty',
  'home',
  'food-drink',
  'crafts',
  'stationery',
  'tech',
  'outdoor',
  'fitness',
  'kids-pets',
])

const failures = []

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isDateLike(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())
}

function checkTrail(file, raw) {
  let data
  try {
    data = matter(raw).data
  } catch (error) {
    return [`${file}: malformed YAML frontmatter (${String(error)})`]
  }

  const fileFailures = []
  for (const field of ['title', 'description', 'promise', 'readerSituation', 'exclusions', 'editorialOwner']) {
    if (!isNonEmptyString(data[field])) fileFailures.push(`${file}: missing \`${field}\``)
  }

  for (const field of ['publishedAt', 'reviewedAt', 'reviewDueAt']) {
    if (!isDateLike(data[field])) fileFailures.push(`${file}: missing or malformed \`${field}\``)
  }

  if (!LOCALES.has(data.locale)) {
    fileFailures.push(`${file}: \`locale\` must be one of ${[...LOCALES].join(', ')}`)
  }

  const stem = file.replace(/\.mdx$/, '')
  if (data.slug !== stem) {
    fileFailures.push(
      `${file}: \`slug\` is ${JSON.stringify(data.slug)} but must equal the filename stem ${JSON.stringify(stem)}`,
    )
  }

  if (!Array.isArray(data.tags) || data.tags.length === 0) {
    fileFailures.push(`${file}: \`tags\` must be a non-empty array`)
  } else {
    data.tags.forEach((tag, index) => {
      if (typeof tag !== 'string' || !L1_CATEGORIES.has(tag)) {
        fileFailures.push(
          `${file}: \`tags[${index}]\` must be an L1 category slug`,
        )
      }
    })
  }

  if (!Array.isArray(data.sections) || data.sections.length === 0) {
    fileFailures.push(`${file}: \`sections\` must be a non-empty array`)
  } else {
    const seenKeys = new Set()
    data.sections.forEach((section, index) => {
      const key = section && typeof section.key === 'string' ? section.key.trim() : ''
      if (!key) fileFailures.push(`${file}: \`sections[${index}].key\` must be non-empty`)
      else if (seenKeys.has(key)) fileFailures.push(`${file}: duplicate section key ${JSON.stringify(key)}`)
      else seenKeys.add(key)
      if (!isNonEmptyString(section?.title)) {
        fileFailures.push(`${file}: \`sections[${index}].title\` must be non-empty`)
      }
    })
  }

  if (!Array.isArray(data.sources) || data.sources.length === 0) {
    fileFailures.push(`${file}: \`sources\` must be a non-empty array`)
  } else {
    for (const source of data.sources) {
      if (typeof source !== 'string' || !/^https?:\/\//.test(source)) {
        fileFailures.push(`${file}: source is not an absolute URL: ${JSON.stringify(source)}`)
      }
    }
  }

  if (!Array.isArray(data.faq) || data.faq.length < FAQ_MIN || data.faq.length > FAQ_MAX) {
    fileFailures.push(`${file}: \`faq\` must contain ${FAQ_MIN}-${FAQ_MAX} entries`)
  } else {
    data.faq.forEach((entry, index) => {
      if (!entry || !isNonEmptyString(entry.q) || !isNonEmptyString(entry.a)) {
        fileFailures.push(`${file}: \`faq[${index}]\` needs both \`q\` and \`a\``)
      }
    })
  }

  if (isNonEmptyString(data.heroImage) && data.heroImage.startsWith('/')) {
    if (!existsSync(join(PUBLIC_DIR, data.heroImage))) {
      fileFailures.push(`${file}: \`heroImage\` not found on disk: ${PUBLIC_DIR}${data.heroImage}`)
    }
  }

  return fileFailures
}

let files
try {
  files = readdirSync(TRAILS_DIR).filter((name) => name.endsWith('.mdx')).sort()
} catch {
  console.log(`Trail frontmatter guard skipped — no ${TRAILS_DIR}/ directory.`)
  process.exit(0)
}

for (const file of files) {
  failures.push(...checkTrail(file, readFileSync(join(TRAILS_DIR, file), 'utf8')))
}

if (failures.length > 0) {
  console.error('Trail frontmatter guard failed:\n')
  for (const failure of failures) console.error(`  ${failure}`)
  console.error(`\n${failures.length} problem(s) across ${files.length} trail file(s).`)
  process.exit(1)
}

console.log(`Trail frontmatter guard passed (${files.length} file(s) scanned).`)
