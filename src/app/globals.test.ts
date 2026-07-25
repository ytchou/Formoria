import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function readBlock(source: string, marker: string) {
  const markerIndex = source.indexOf(marker)
  const openIndex = source.indexOf('{', markerIndex)
  let depth = 0

  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(openIndex + 1, index)
  }

  throw new Error(`Unclosed CSS block: ${marker}`)
}

describe('global H2 contract', () => {
  it('keeps the H2 typography and accent inside the compiled base layer', () => {
    const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8')
    const baseLayer = readBlock(css, '@layer base')

    expect(baseLayer).toContain('h2 {')
    expect(baseLayer).toContain('h2::before {')
  })

  it('provides the padded section-heading treatment used by content pages', () => {
    const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8')

    expect(css).toContain('.section-heading-scope h2 {')
    expect(css).toContain(
      '@apply flex min-h-12 items-center border-b-2 border-primary px-4 type-nav-item-active md:border-b-0 md:border-l-2 md:px-3;',
    )
    expect(css).toContain('font-size: var(--text-sm) !important;')
    expect(css).toContain('line-height: var(--text-sm--line-height) !important;')
    expect(css).toContain('.section-heading-scope h2::before {')
  })
})
