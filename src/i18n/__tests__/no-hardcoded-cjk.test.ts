import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * i18n regression guard — Chinese-in-English direction.
 *
 * User-facing copy must come from `messages/*.json` via next-intl, never be
 * hardcoded. This test fails if any Han ideograph appears in source under
 * `src/` outside the allowlist below. New leaks therefore fail CI.
 *
 * The allowlist holds intentional single-locale or copy-in-source surfaces.
 * When something here is genuinely intentional (e.g. an admin-only screen),
 * add its path. Otherwise, move the string into `messages/*.json`.
 */

const SRC = join(process.cwd(), 'src')

// Han ideographs (main + Ext-A + compatibility). Catches any Chinese string.
const HAN = /[㐀-鿿豈-﫿]/

const ALLOWLIST = [
  // Admin surface is intentionally single-locale (Chinese-only).
  'components/admin/',
  'app/admin/',
  // Preview/under-construction gate is zh-only by design.
  'lib/preview/',
  // Email copy lives in-file and is locale-branched inside the template.
  'lib/email/templates.ts',
  // Language endonyms (中文 / English) — correct in both locales.
  'components/i18n/locale-switcher.tsx',
  // OG images: rendered to PNG, locale-branched or zh default by design.
  'app/opengraph-image.tsx',
  'app/[locale]/brands/[slug]/opengraph-image.tsx',
  'app/[locale]/categories/opengraph-image.tsx',
  'app/[locale]/categories/[category]/opengraph-image.tsx',
  // Structured data + glossary: inline `locale === 'zh-TW' ? … : …` (locale-aware).
  'lib/json-ld.ts',
  'app/[locale]/glossary/page.tsx',
  // Root metadata fallback ([locale] layout overrides) + a zh comment.
  'app/layout.tsx',
  // Auth pages live outside [locale] (no request locale) — metadata zh fallback.
  'app/auth/sign-in/page.tsx',
  'app/auth/sign-up/page.tsx',
  // Owner mailto subject — locale-branched template.
  'components/dashboard/mit-status-card.tsx',
  // Non-display Chinese: a comment and scraper keyword regex.
  'lib/constants.ts',
  'lib/services/scraper/strategies/crawl.ts',
  // Taxonomy ontology: nameZh is structural data (bilingual label in data layer, not UI copy).
  'lib/taxonomy/ontology.ts',
  // Transitional: real messages come from the i18n factory; static fallback map
  // here is test-only. TODO remove the static fallback and drop this entry.
  'lib/validations/submission.ts',
  // Microsite is intentionally ZH-TW-only (v1 single-locale surface, DEV-767).
  'components/microsite/',
  'app/(microsite)/',
]

function isAllowlisted(relPath: string): boolean {
  const p = relPath.split(sep).join('/')
  return ALLOWLIST.some((a) => (a.endsWith('/') ? p.startsWith(a) : p === a))
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue
      out.push(...walk(full))
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('i18n guard — no hardcoded Chinese in source', () => {
  it('source outside the allowlist contains no Han characters', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file)
      if (isAllowlisted(rel)) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (HAN.test(line)) {
          offenders.push(`${rel.split(sep).join('/')}:${i + 1}  ${line.trim().slice(0, 90)}`)
        }
      })
    }
    expect(
      offenders,
      `Hardcoded Chinese found in source. Move it into messages/*.json (or allowlist if intentional single-locale):\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
