import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), 'utf8')
}

// The font declarations live in the shared RootDocument, which wraps every
// layout (locale, microsite, admin, auth) rather than only the root.
const rootDocument = readProjectFile('src/components/shared/root-document.tsx')
const globals = readProjectFile('src/app/globals.css')

// The v1 gate asserted the opposite of every case below: it pinned three Latin
// faces and forbade a CJK webfont. Design system v2 reverses that decision — see
// docs/decisions/2026-08-20-two-cjk-webfonts-supersede-the-system-face-rule.md.
//
// The assertions stay `toContain` on byte-exact literals rather than regexes.
// That is the whole point of this gate: a silent change to the font stack (a
// renamed CSS variable, a dropped fallback, a re-added Latin face) has to fail
// here, and a regex loose enough to survive refactoring is loose enough to miss
// the change it exists to catch.
describe('zh-TW heading font configuration', () => {
  it('root document loads both v2 font families', () => {
    expect(rootDocument).toContain('Noto_Serif_TC')
    expect(rootDocument).toContain('Noto_Sans_TC')
    expect(rootDocument).toContain('--font-noto-serif-tc')
    expect(rootDocument).toContain('--font-noto-sans-tc')
  })

  it('root document loads no Latin-only face', () => {
    expect(rootDocument).not.toContain('Inter')
    expect(rootDocument).not.toContain('Bricolage_Grotesque')
    expect(rootDocument).not.toContain('Geist_Mono')
  })

  it('globals declares both v2 font stacks', () => {
    expect(globals).toContain(
      '--font-ming: var(--font-noto-serif-tc), "Songti TC", serif;',
    )
    expect(globals).toContain(
      '--font-hei: var(--font-noto-sans-tc), "PingFang TC", sans-serif;',
    )
  })
})
