import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ROOT = process.cwd()
const SCAN_DIRS = [
  join(PROJECT_ROOT, 'src'),
  join(PROJECT_ROOT, 'scripts'),
]

/**
 * Recursively collect .ts files, skipping test files and node_modules.
 */
function collectTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      files.push(...collectTsFiles(full))
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.includes('.test.')
    ) {
      files.push(full)
    }
  }
  return files
}

type InsertSite = { file: string; line: number; text: string }

function findInsertSites(table: string): InsertSite[] {
  // Regex literals — not values derived from a sweep
  // (feedback_sweeps-rewrite-guard-test-data)
  const pattern = new RegExp(
    `\\.from\\(\\s*['"\`]${table}['"\`]\\s*\\)\\s*\\.insert`,
  )
  const sites: InsertSite[] = []

  for (const dir of SCAN_DIRS) {
    for (const file of collectTsFiles(dir)) {
      const source = readFileSync(file, 'utf8')
      const lines = source.split('\n')
      for (let i = 0; i < lines.length; i++) {
        // Test single line first, then a two-line window to catch
        // .from("table")\n  .insert({ patterns split across lines.
        const window = i + 1 < lines.length
          ? lines[i]! + ' ' + lines[i + 1]!
          : lines[i]!
        if (pattern.test(lines[i]!) || pattern.test(window)) {
          sites.push({
            file: relative(PROJECT_ROOT, file),
            line: i + 1,
            text: lines[i]!.trim(),
          })
        }
      }
    }
  }

  return sites
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('audit insert sites', () => {
  it('external_call_audit inserts only in src/lib/audit/emit.ts', () => {
    const sites = findInsertSites('external_call_audit')
    const files = sites.map((s) => s.file)

    expect(files).toEqual(
      expect.arrayContaining([expect.stringMatching(/^src\/lib\/audit\/emit\.ts$/)]),
    )
    // Every site must be in emit.ts — no other file may insert
    for (const site of sites) {
      expect(site.file).toMatch(/^src\/lib\/audit\/emit\.ts$/)
    }
  })

  it('brand_ai_results inserts only in src/lib/services/_shared/ai-results.ts', () => {
    const sites = findInsertSites('brand_ai_results')
    const files = sites.map((s) => s.file)

    expect(files).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^src\/lib\/services\/_shared\/ai-results\.ts$/),
      ]),
    )
    // Every site must be in ai-results.ts — no other file may insert
    for (const site of sites) {
      expect(site.file).toMatch(/^src\/lib\/services\/_shared\/ai-results\.ts$/)
    }
  })
})
