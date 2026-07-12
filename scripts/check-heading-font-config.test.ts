import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), 'utf8')
}

describe('zh-TW heading font configuration', () => {
  it('uses the sans CJK fallback without loading the serif family', () => {
    const layout = readProjectFile('src/app/layout.tsx')
    const globals = readProjectFile('src/app/globals.css')

    expect(layout).not.toContain('Noto_Serif_TC')
    expect(layout).not.toContain('--font-noto-serif-tc')
    expect(globals).not.toContain('var(--font-noto-serif-tc)')
    expect(globals).toContain(
      '--font-heading: var(--font-bricolage), var(--font-noto-tc), ui-sans-serif, system-ui, sans-serif;',
    )
  })
})
