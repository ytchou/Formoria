import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SERVICES_DIR = join(ROOT, 'src/lib/services')
const SHARED_DIR = join(SERVICES_DIR, '_shared')
const IMPORT_SPECIFIER = /from\s+['"]([^'"]+)['"]/g

/** Files directly under a directory, excluding tests and nested directories. */
function moduleFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.test.'),
    )
    .map((entry) => join(dir, entry.name))
}

/**
 * Repo-relative path a specifier points at, or null for bare package and
 * `node:` specifiers. Extension-less by design: callers match on path shape,
 * not on module resolution.
 */
function targetPath(file: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return join('src', specifier.slice(2))
  if (specifier.startsWith('.')) return relative(ROOT, resolve(file, '..', specifier))
  return null
}

function importTargets(file: string): { specifier: string; target: string }[] {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(IMPORT_SPECIFIER)].flatMap((match) => {
    const specifier = match[1]!
    const target = targetPath(file, specifier)
    return target ? [{ specifier, target }] : []
  })
}

// Domain modules the shared kernel must never reach back into. Reaching any of
// these re-forms one of the services-level cycles the _shared extraction broke.
const DOMAIN_MODULES = /src\/lib\/services\/(enrich-phases\/|curation-|brands|llm-audit)/

// Enrichment-domain modules inside services. The kernel's own enrichment-target
// does not count: it lives under _shared/ and is the point of the extraction.
// `@/lib/constants/enrichment-config` is a constant, not a service module.
const ENRICHMENT_DOMAIN =
  /src\/lib\/services\/(enrich-phases\/|enrich-validators|enrichment-logger|enrichment-target)/

const LLM_DOMAIN_FILES = [
  'src/lib/services/llm-audit.ts',
  'src/lib/services/llm-pricing.ts',
]

describe('services shared kernel has no domain cycles', () => {
  it('shared kernel imports no domain module', () => {
    const offenders = moduleFiles(SHARED_DIR).flatMap((file) =>
      importTargets(file)
        .filter(({ target }) => DOMAIN_MODULES.test(target))
        .map(({ specifier }) => `${relative(SERVICES_DIR, file)}: ${specifier}`),
    )

    expect(offenders).toEqual([])
  })

  it('enrichment no longer depends on llm and vice versa', () => {
    // Only the llm -> enrichment direction is asserted. enrichment -> llm is a
    // live, intentional edge (enrich-phases calls into llm-audit); breaking the
    // cycle means removing the back-edge, not both.
    const offenders = LLM_DOMAIN_FILES.flatMap((relPath) =>
      importTargets(join(ROOT, relPath))
        .filter(({ target }) => ENRICHMENT_DOMAIN.test(target))
        .map(({ specifier }) => `${relPath}: ${specifier}`),
    )

    expect(offenders).toEqual([])
  })
})
