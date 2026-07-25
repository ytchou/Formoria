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

  it('uses a compact accent without navigation-row styling', () => {
    const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8')
    const baseLayer = readBlock(css, '@layer base')

    expect(baseLayer).toContain('height: calc(var(--spacing) * 5);')
    expect(baseLayer).toContain('margin-inline-end: calc(var(--spacing) * 3);')
    expect(baseLayer).toContain('background-color: var(--primary);')
    expect(css).not.toContain('.section-heading-scope h2')
  })
})
