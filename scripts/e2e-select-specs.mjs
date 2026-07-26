import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

/**
 * Shortest i18n value worth grepping for. Below this, a string like "OK" or
 * "關閉" appears in so many specs that it would select the whole suite.
 */
const MIN_I18N_STRING_LENGTH = 4

/**
 * A removed i18n value matching more than this many specs is a generic token
 * (`owner`, `Admin`, `verified`) that appears incidentally, not a page-specific
 * assertion. Measured against the current suite: 104 of 138 message values
 * present in specs match exactly one spec, and everything above 5 is one of
 * four such tokens.
 */
const MAX_SPECS_PER_I18N_STRING = 5

/**
 * Pure function — exported for testing.
 * Prefix-matches changedFiles against routeMap keys.
 * A changed file matches a key if the file starts with `key + '/'` or equals `key`.
 */
export function selectSpecs(changedFiles, routeMap) {
  const specSet = new Set()
  for (const file of changedFiles) {
    for (const [routeKey, specs] of Object.entries(routeMap)) {
      if (file.startsWith(routeKey + '/') || file === routeKey) {
        specs.forEach(s => specSet.add(s))
      }
    }
  }
  return [...specSet]
}

/**
 * Changed files that are themselves specs. Replaces Playwright's
 * `--only-changed` pass so the whole selection is one list and one run.
 */
export function selectChangedSpecs(changedFiles) {
  return changedFiles.filter(
    file => file.startsWith('e2e/') && file.endsWith('.spec.ts')
  )
}

/**
 * String literals a diff REMOVED from i18n message files. Specs match on
 * rendered copy, so it is the OLD value a spec still references — the new one
 * cannot break anything that does not mention it yet.
 */
export function parseRemovedI18nStrings(diffText) {
  const values = new Set()
  for (const line of diffText.split('\n')) {
    if (!line.startsWith('-') || line.startsWith('---')) continue
    const match = line.match(/:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/)
    if (!match) continue
    try {
      const value = JSON.parse(`"${match[1]}"`)
      if (value.length >= MIN_I18N_STRING_LENGTH) values.add(value)
    } catch {
      // Not a decodable JSON string — skip rather than widen the selection.
    }
  }
  return [...values]
}

/**
 * Specs that still reference a removed i18n string. `findSpecsContaining` is
 * injected so this stays pure under test.
 */
export function selectSpecsForRemovedStrings(
  removedStrings,
  findSpecsContaining
) {
  const specSet = new Set()
  for (const value of removedStrings) {
    const matched = findSpecsContaining(value)
    if (matched.length > MAX_SPECS_PER_I18N_STRING) continue
    for (const spec of matched) specSet.add(spec)
  }
  return [...specSet]
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

/** Fixed-string, no-shell grep. Exit 1 means no match, which is not an error. */
function findSpecsContaining(value) {
  try {
    return execFileSync('grep', ['-rlF', value, 'e2e/tests'], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

// CLI entry point — only runs when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const routeMap = JSON.parse(
    readFileSync(join(__dirname, 'e2e-route-map.json'), 'utf8')
  )

  const base = process.env.E2E_SELECT_BASE ?? 'origin/main'

  let changedFiles = []
  try {
    // --diff-filter=d excludes deletions: a deleted spec must never be handed
    // to Playwright as a positional path, which would fail the whole run.
    changedFiles = git([
      'diff',
      '--name-only',
      '--diff-filter=d',
      `${base}...HEAD`,
    ])
      .split('\n')
      .filter(Boolean)
  } catch {
    // No git history or detached HEAD — output nothing and exit cleanly
    process.exit(0)
  }

  let removedI18nStrings = []
  if (changedFiles.some(file => file.startsWith('messages/'))) {
    try {
      removedI18nStrings = parseRemovedI18nStrings(
        git(['diff', '-U0', `${base}...HEAD`, '--', 'messages/'])
      )
    } catch {
      removedI18nStrings = []
    }
  }

  const specs = [
    ...new Set([
      ...selectSpecs(changedFiles, routeMap),
      ...selectChangedSpecs(changedFiles),
      ...selectSpecsForRemovedStrings(removedI18nStrings, findSpecsContaining),
    ]),
  ].sort()

  if (specs.length > 0) {
    process.stdout.write(specs.join(' '))
  }
}
