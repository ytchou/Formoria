import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const globals = readFileSync(join(projectRoot, 'src/app/globals.css'), 'utf8')

/**
 * Design system v2 collapses 37 `type-*` utilities into 12 roles, and the two
 * interaction tokens (`--primary`, `--cta`) into one (`--accent`).
 *
 * This gate exists because neither collapse is enforceable by tsc or eslint: a
 * `type-body-muted` that survives the codemod is a class Tailwind never
 * generates, so it compiles, type-checks, lints, and renders as unstyled text
 * on a page nobody opened during review. The same is true of `bg-primary` once
 * `--primary` is gone. Both failures are silent everywhere except here.
 *
 * The role list is pinned as a literal rather than parsed from a spec file:
 * `docs/` is gitignored, so anything derived from DESIGN.md is absent in CI.
 */
const V2_TYPE_ROLES = [
  // 明體 (font-ming) — content
  'type-display',
  'type-page-title',
  'type-section',
  'type-card-title',
  'type-body',
  'type-body-sm',
  // 黑體 (font-hei) — interface
  'type-button',
  'type-nav',
  'type-label',
  'type-metadata',
  'type-micro',
  'type-eyebrow',
] as const

/**
 * Every v1 name the codemod retires. `type-metadata`, `type-micro`,
 * `type-label` and `type-eyebrow` are absent because they survive under the
 * same name with a v2 declaration.
 */
const RETIRED_TYPE_NAMES = [
  'type-hero',
  'type-page-title-large',
  'type-page-subtitle',
  'type-section-title',
  'type-section-title-large',
  'type-section-description',
  'type-card-title-small',
  'type-card-description',
  'type-faq-question',
  'type-subsection-title',
  'type-field-label',
  'type-field-value',
  'type-form-label',
  'type-form-hint',
  'type-body-muted',
  'type-body-inverse',
  'type-body-emphasis',
  'type-caption',
  'type-eyebrow-muted',
  'type-eyebrow-foreground',
  'type-stat',
  'type-nav-item',
  'type-nav-item-active',
  'type-link',
  'type-error',
  'type-success',
  'type-success-panel',
  'type-empty-title',
  'type-empty-body',
] as const

const SOURCE_ROOTS = ['src', 'e2e']
const SOURCE_EXTENSIONS = /\.(ts|tsx|mjs|css)$/

function collectSourceFiles(root: string) {
  const files: string[] = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    for (const entry of readdirSync(join(projectRoot, current), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue

      const child = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(child)
        continue
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) files.push(child)
    }
  }

  return files.sort()
}

const sourceFiles = SOURCE_ROOTS.flatMap(collectSourceFiles).map((file) => ({
  path: relative('.', file),
  source: readFileSync(join(projectRoot, file), 'utf8'),
}))

function findMatches(pattern: RegExp) {
  const hits: string[] = []

  for (const file of sourceFiles) {
    for (const [index, line] of file.source.split('\n').entries()) {
      for (const match of line.matchAll(new RegExp(pattern.source, 'g'))) {
        hits.push(`${file.path}:${index + 1} ${match[0]}`)
      }
    }
  }

  return hits
}

describe('design system v2 type roles', () => {
  it('globals declares exactly the 12 v2 roles', () => {
    const declared = [...globals.matchAll(/@utility (type-[a-z-]+)/g)].map((match) => match[1])

    expect([...declared].sort()).toEqual([...V2_TYPE_ROLES].sort())
  })

  it('defines type-button, which v1 used but never declared', () => {
    // discover/[slug]/not-found.tsx carried `type-button` against no @utility
    // block at all, so that CTA rendered with no type treatment whatsoever.
    expect(globals).toContain('@utility type-button')
  })

  it('no retired type name survives in src or e2e', () => {
    // `(?![\w-])` rather than `\b`: `-` is a non-word character, so a word
    // boundary after `type-nav` matches inside `type-nav-item` and the two
    // names become indistinguishable.
    const retired = RETIRED_TYPE_NAMES.join('|')

    expect(findMatches(new RegExp(`\\b(${retired})(?![\\w-])`))).toEqual([])
  })

  it('type utilities bind the v2 font tokens, not the v1 aliases', () => {
    expect(globals).toContain('font-ming')
    expect(globals).toContain('font-hei')
    expect(globals).not.toMatch(/--font-sans:/)
    expect(globals).not.toMatch(/--font-heading:/)
    expect(findMatches(/\bfont-(sans|heading)(?![\w-])/)).toEqual([])
  })
})

describe('design system v2 single accent', () => {
  it('globals declares neither --primary nor --cta', () => {
    expect(globals).not.toMatch(/^\s*--primary(-foreground|-dark|-light)?:/m)
    expect(globals).not.toMatch(/^\s*--cta(-foreground)?:/m)
  })

  it('declares the indigo accent exactly once', () => {
    expect([...globals.matchAll(/#2F4F63/g)]).toHaveLength(1)
  })

  it('no primary or cta colour utility survives in src or e2e', () => {
    const utilities =
      '(bg|text|border|ring|outline|from|to|via|fill|stroke|decoration|shadow|accent|caret|divide|placeholder)'

    expect(
      findMatches(new RegExp(`\\b${utilities}-(primary|cta)(-[a-z]+)*(?![\\w-])`)),
    ).toEqual([])
  })
})
