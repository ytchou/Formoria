import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('runlog module purity', () => {
  it('imports nothing from outside src/lib/runlog', () => {
    const dir = join(process.cwd(), 'src/lib/runlog')
    const offenders: string[] = []

    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.includes('.test.'))) {
      const source = readFileSync(join(dir, file), 'utf8')
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1]!
        if (
          specifier.startsWith('@/') ||
          specifier.startsWith('..') ||
          (!specifier.startsWith('.') && !specifier.startsWith('node:'))
        ) {
          offenders.push(`${file}: ${specifier}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
