import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('revalidate-client module purity', () => {
  it('imports nothing but node: builtins — any other import breaks the tsx scripts', () => {
    const file = join(process.cwd(), 'src/lib/cache/revalidate-client.ts')
    const source = readFileSync(file, 'utf8')
    const offenders: string[] = []

    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1]!
      if (!specifier.startsWith('node:')) {
        offenders.push(specifier)
      }
    }

    // `import('...')` / `require('...')` would sneak Next in past the `from` scan.
    for (const match of source.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g)) {
      const specifier = match[1]!
      if (!specifier.startsWith('node:')) {
        offenders.push(specifier)
      }
    }

    expect(offenders).toEqual([])
  })
})
