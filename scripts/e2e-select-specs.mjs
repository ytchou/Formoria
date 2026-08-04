import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']
const ROUTE_ENTRYPOINT =
  /^src\/app\/(?:.*\/)?(?:page|layout|route|template|default)\.(?:ts|tsx)$/
/**
 * A layout, template, or default wraps its whole subtree, so its route pattern
 * matches every descendant route — not just the one at its own depth. A `page`
 * or `route` owns exactly one route and stays an exact match.
 */
const SUBTREE_ENTRYPOINT =
  /^src\/app\/(?:.*\/)?(?:layout|template|default)\.(?:ts|tsx)$/

/**
 * Only `e2e/tests/**` is selectable. The workflow runs the `deep` and `mobile`
 * projects, which collectively own those specs; a path from `e2e/smoke/` would
 * filter every test out and fail the run with "no tests found".
 */
const SELECTABLE_SPEC = /^e2e\/tests\/.+\.spec\.ts$/
const SMOKE_SPEC = /^e2e\/smoke\/.+\.spec\.ts$/
const BROWSER_APP_DIRECTORY = /^src\/app\//
const BROWSER_SOURCE_DIRECTORY = /^src\/(?:components|hooks|i18n)\//
const BROWSER_ASSET = /^src\/assets\//
const BROWSER_PROXY = /^src\/(?:proxy|middleware)\.(?:ts|tsx|js|jsx)$/
const BROWSER_STYLE = /\.(?:css|scss|sass|less)$/
const BROWSER_PUBLIC_ASSET = /^public\//
const BROWSER_MESSAGES = /^messages\/.+\.json$/
const PLAYWRIGHT_CONFIG = /^playwright\.config\.[cm]?[jt]sx?$/

/** Files that participate in the import graph. */
export function isCodeFile(file) {
  return CODE_EXTENSIONS.some(extension => file.endsWith(extension))
}

/** An App Router file that defines a route. */
export function isRouteEntrypoint(file) {
  return ROUTE_ENTRYPOINT.test(file)
}

/** An App Router file whose route pattern covers every descendant route. */
export function isSubtreeEntrypoint(file) {
  return SUBTREE_ENTRYPOINT.test(file)
}

/** A spec the selective PR job is able to run. */
export function isSelectableSpec(file) {
  return SELECTABLE_SPEC.test(file)
}

/** A tracked file that can affect browser-visible behavior or the smoke flow. */
export function isBrowserImpactingFile(file) {
  return (
    BROWSER_APP_DIRECTORY.test(file) ||
    BROWSER_SOURCE_DIRECTORY.test(file) ||
    BROWSER_ASSET.test(file) ||
    BROWSER_PROXY.test(file) ||
    BROWSER_STYLE.test(file) ||
    BROWSER_PUBLIC_ASSET.test(file) ||
    BROWSER_MESSAGES.test(file) ||
    PLAYWRIGHT_CONFIG.test(file) ||
    SMOKE_SPEC.test(file)
  )
}

export function isSmokeSpec(file) {
  return SMOKE_SPEC.test(file)
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

export function shouldRunSmoke(changedFiles, reverseGraph) {
  if (changedFiles.some(isBrowserImpactingFile)) return true

  const reachable = collectReachableImporters(changedFiles, reverseGraph)
  return [...reachable].some(isSmokeSpec)
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

export function matchesRoute(concreteRoute, pattern, { subtree = false } = {}) {
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

  return subtree
    ? concreteSegments.length >= patternSegments.length
    : concreteSegments.length === patternSegments.length
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
    .map(entrypoint => ({
      pattern: routePatternFor(entrypoint),
      subtree: isSubtreeEntrypoint(entrypoint),
    }))
  if (patterns.length === 0) return []

  const specs = []
  for (const [spec, routes] of routesBySpec) {
    if (
      [...routes].some(route =>
        patterns.some(({ pattern, subtree }) =>
          matchesRoute(route, pattern, { subtree }),
        ),
      )
    ) {
      specs.push(spec)
    }
  }
  return specs
}

export function selectChangedSpecs(changedFiles) {
  return changedFiles.filter(isSelectableSpec)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const smokeMode = process.argv.includes('--smoke')
  const git = args =>
    execFileSync('git', args, { encoding: 'utf8', cwd: repoRoot })
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
    if (smokeMode) process.stdout.write('false')
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

  if (smokeMode) {
    process.stdout.write(
      shouldRunSmoke(changedFiles, selectionIndex.reverseGraph) ? 'true' : 'false',
    )
    process.exit(0)
  }

  const specs = [
    ...new Set([
      ...selectDerivedSpecs(changedFiles, selectionIndex),
      ...selectChangedSpecs(changedFiles),
    ]),
  ].sort()

  if (specs.length > 0) process.stdout.write(specs.join(' '))
}
