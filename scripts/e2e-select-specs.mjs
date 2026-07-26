import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIN_I18N_STRING_LENGTH = 4
const MAX_SPECS_PER_I18N_STRING = 5
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']
const ROUTE_ENTRYPOINT =
  /^src\/app\/(?:.*\/)?(?:page|layout|route|template|default)\.(?:ts|tsx)$/

/**
 * Only `e2e/tests/**` is selectable. The workflow runs `--project=deep`, whose
 * testMatch is `e2e/tests/**\/*.spec.ts`; a path from `e2e/smoke/` would filter
 * every test out of that project and fail the run with "no tests found".
 */
const SELECTABLE_SPEC = /^e2e\/tests\/.+\.spec\.ts$/

/** Files that participate in the import graph. */
export function isCodeFile(file) {
  return CODE_EXTENSIONS.some(extension => file.endsWith(extension))
}

/** An App Router file that defines a route. */
export function isRouteEntrypoint(file) {
  return ROUTE_ENTRYPOINT.test(file)
}

/** A spec the selective PR job is able to run. */
export function isSelectableSpec(file) {
  return SELECTABLE_SPEC.test(file)
}

export function resolveImport(fromFile, specifier, fileExists) {
  let basePath
  if (specifier.startsWith('@/')) {
    basePath = `src/${specifier.slice(2)}`
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    basePath = posix.normalize(posix.join(posix.dirname(fromFile), specifier))
  } else {
    return null
  }

  if (basePath === '..' || basePath.startsWith('../') || basePath.startsWith('/')) {
    return null
  }

  const candidates = [
    basePath,
    ...CODE_EXTENSIONS.map(extension => `${basePath}${extension}`),
    ...CODE_EXTENSIONS.map(extension => `${basePath}/index${extension}`),
  ]
  return candidates.find(fileExists) ?? null
}

export function extractImports(sourceText) {
  const specifiers = []
  const importPattern =
    /\b(?:import|export)\s+(?:(?:type\s+)?[^'";]*?\s+from\s+)?(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3\s*\)/g
  for (const match of sourceText.matchAll(importPattern)) {
    specifiers.push(match[2] ?? match[4])
  }
  return specifiers
}

export function buildReverseImportGraph(files, sourceByFile, fileExists) {
  const reverseGraph = new Map()
  for (const importer of files) {
    const sourceText = sourceByFile.get(importer)
    if (sourceText === undefined) continue
    for (const specifier of extractImports(sourceText)) {
      const importee = resolveImport(importer, specifier, fileExists)
      if (importee === null) continue
      const importers = reverseGraph.get(importee) ?? new Set()
      importers.add(importer)
      reverseGraph.set(importee, importers)
    }
  }
  return reverseGraph
}

export function collectReachableImporters(startFiles, reverseGraph) {
  const reachable = new Set(startFiles)
  const queue = [...startFiles]
  for (let index = 0; index < queue.length; index += 1) {
    const importers = reverseGraph.get(queue[index]) ?? []
    for (const importer of importers) {
      if (reachable.has(importer)) continue
      reachable.add(importer)
      queue.push(importer)
    }
  }
  return reachable
}

export function routePatternFor(entrypoint) {
  const routePath = entrypoint
    .replace(/^src\/app\//, '')
    .replace(/(?:^|\/)(?:page|layout|route|template|default)\.(?:ts|tsx)$/, '')
  const segments = routePath
    .split('/')
    .filter(segment => segment && segment !== '[locale]' && !/^\(.+\)$/.test(segment))
  return segments.length === 0 ? '/' : `/${segments.join('/')}`
}

export function extractRoutes(sourceText) {
  const routes = new Set()
  const routeCallPattern =
    /(?:\bfetch|\.\s*(?:goto|get|post|put|delete))\s*\(\s*(['"`])([\s\S]*?)\1/g
  for (const match of sourceText.matchAll(routeCallPattern)) {
    if (!match[2].startsWith('/')) continue
    let route = match[2]
      .replace(/\$\{[^}]*\}/g, '*')
      .split('?')[0]
      // A fragment addresses a section of the same page: `/faq#claim` is `/faq`.
      .split('#')[0]
      .replace(/^\/(?:en|zh-TW)(?=\/|$)/, '')
    if (route === '') route = '/'
    routes.add(route)
  }
  return [...routes]
}

export function matchesRoute(concreteRoute, pattern) {
  const concreteSegments = concreteRoute.split('/').filter(Boolean)
  const patternSegments = pattern.split('/').filter(Boolean)

  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index]
    if (
      /^\[\.\.\.[^\]]+\]$/.test(patternSegment) ||
      /^\[\[\.\.\.[^\]]+\]\]$/.test(patternSegment)
    ) {
      return index < concreteSegments.length
    }

    const concreteSegment = concreteSegments[index]
    if (concreteSegment === undefined) return false
    if (concreteSegment === '*') continue
    if (/^\[[^.[\]]+\]$/.test(patternSegment)) continue
    if (concreteSegment !== patternSegment) return false
  }

  return concreteSegments.length === patternSegments.length
}

export function collectSpecRoutes(
  specFiles,
  e2eFiles,
  sourceByFile,
  reverseGraph,
) {
  const specSet = new Set(specFiles)
  const routesBySpec = new Map(specFiles.map(spec => [spec, new Set()]))

  for (const file of e2eFiles) {
    const routes = extractRoutes(sourceByFile.get(file) ?? '')
    if (routes.length === 0) continue
    const importers = collectReachableImporters([file], reverseGraph)
    for (const importer of importers) {
      if (!specSet.has(importer)) continue
      const specRoutes = routesBySpec.get(importer)
      for (const route of routes) specRoutes.add(route)
    }
  }

  return routesBySpec
}

/**
 * Everything the selection needs, derived once from the source tree. Built by
 * the CLI and by the tests through the same code path, so a test can never
 * pass against a shape the CLI does not actually produce.
 */
export function buildSelectionIndex(files, sourceByFile, fileExists) {
  const reverseGraph = buildReverseImportGraph(files, sourceByFile, fileExists)
  return {
    reverseGraph,
    routeEntrypoints: files.filter(isRouteEntrypoint),
    routesBySpec: collectSpecRoutes(
      files.filter(isSelectableSpec),
      files.filter(file => file.startsWith('e2e/')),
      sourceByFile,
      reverseGraph,
    ),
  }
}

export function selectDerivedSpecs(
  changedFiles,
  { reverseGraph, routeEntrypoints, routesBySpec },
) {
  const reachable = collectReachableImporters(changedFiles, reverseGraph)
  const patterns = routeEntrypoints
    .filter(entrypoint => reachable.has(entrypoint))
    .map(routePatternFor)
  if (patterns.length === 0) return []

  const specs = []
  for (const [spec, routes] of routesBySpec) {
    if ([...routes].some(route => patterns.some(pattern => matchesRoute(route, pattern)))) {
      specs.push(spec)
    }
  }
  return specs
}

export function selectChangedSpecs(changedFiles) {
  return changedFiles.filter(isSelectableSpec)
}

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

export function selectSpecsForRemovedStrings(
  removedStrings,
  findSpecsContaining,
) {
  const specSet = new Set()
  for (const value of removedStrings) {
    const matched = findSpecsContaining(value)
    if (matched.length > MAX_SPECS_PER_I18N_STRING) continue
    for (const spec of matched) specSet.add(spec)
  }
  return [...specSet]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const git = args =>
    execFileSync('git', args, { encoding: 'utf8', cwd: repoRoot })
  const findSpecsContaining = value => {
    try {
      return execFileSync('grep', ['-rlF', value, 'e2e/tests'], {
        encoding: 'utf8',
        cwd: repoRoot,
      })
        .split('\n')
        .filter(Boolean)
    } catch {
      return []
    }
  }
  const base = process.env.E2E_SELECT_BASE ?? 'origin/main'

  let changedFiles = []
  try {
    changedFiles = git([
      'diff',
      '--name-only',
      '--diff-filter=d',
      `${base}...HEAD`,
    ])
      .split('\n')
      .filter(Boolean)
  } catch {
    process.exit(0)
  }

  const trackedFiles = git(['ls-files', 'src', 'e2e'])
    .split('\n')
    .filter(Boolean)
  const trackedSet = new Set(trackedFiles)
  const files = trackedFiles.filter(isCodeFile)
  const sourceByFile = new Map()
  for (const file of files) {
    try {
      sourceByFile.set(file, readFileSync(join(repoRoot, file), 'utf8'))
    } catch {
      // Tracked but absent from the working tree: skip it rather than crash
      // the gate. The graph builder already tolerates a missing source.
    }
  }
  const selectionIndex = buildSelectionIndex(
    files,
    sourceByFile,
    file => trackedSet.has(file),
  )

  let removedI18nStrings = []
  if (changedFiles.some(file => file.startsWith('messages/'))) {
    try {
      removedI18nStrings = parseRemovedI18nStrings(
        git(['diff', '-U0', `${base}...HEAD`, '--', 'messages/']),
      )
    } catch {
      removedI18nStrings = []
    }
  }

  const specs = [
    ...new Set([
      ...selectDerivedSpecs(changedFiles, selectionIndex),
      ...selectChangedSpecs(changedFiles),
      ...selectSpecsForRemovedStrings(removedI18nStrings, findSpecsContaining),
    ]),
  ].sort()

  if (specs.length > 0) process.stdout.write(specs.join(' '))
}
