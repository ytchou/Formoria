import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIN_I18N_STRING_LENGTH = 4
const MAX_SPECS_PER_I18N_STRING = 5
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']
const ROUTE_ENTRYPOINT =
  /^src\/app\/(?:.*\/)?(?:page|layout|route|template|default)\.(?:ts|tsx|js|jsx)$/
const PAGE_ENTRYPOINT =
  /^src\/app\/(?:.*\/)?page\.(?:ts|tsx|js|jsx)$/
/**
 * A layout, template, or default wraps its whole subtree, so its route pattern
 * matches every descendant route — not just the one at its own depth. A `page`
 * or `route` owns exactly one route and stays an exact match.
 */
const SUBTREE_ENTRYPOINT =
  /^src\/app\/(?:.*\/)?(?:layout|template|default)\.(?:ts|tsx|js|jsx)$/

/**
 * Only `e2e/tests/**` is selectable. The workflow runs the `deep` and `mobile`
 * projects, which collectively own those specs; a path from `e2e/smoke/` would
 * filter every test out and fail the run with "no tests found".
 */
const SELECTABLE_SPEC = /^e2e\/tests\/.+\.spec\.ts$/

const CROSS_BROWSER_SPEC = 'e2e/tests/landing-search-cross-browser.spec.ts'
const CROSS_BROWSER_PROJECTS = [
  'cross-browser-chromium',
  'cross-browser-firefox',
  'cross-browser-webkit',
]

const BROAD_SMOKE_FALLBACK = [
  /^messages\//,
  /^public\//,
  /^src\/app\/globals\.(?:css|scss|sass|less)$/,
  /^src\/app\/layout\.(?:ts|tsx|js|jsx)$/,
  /^src\/app\/\[locale\]\/layout\.(?:ts|tsx|js|jsx)$/,
  /^src\/app\/\[locale\]\/\(site\)\/layout\.(?:ts|tsx|js|jsx)$/,
  /^src\/components\/(?:navigation|shared|ui)\//,
  /^src\/i18n\//,
  /^src\/lib\/i18n\//,
  /^playwright\.config\.[cm]?[jt]sx?$/,
  /^src\/proxy\.(?:ts|tsx|js|jsx)$/,
]

const CROSS_BROWSER_TRIGGERS = [
  {
    matches: file => /^playwright\.config\.[cm]?[jt]sx?$/.test(file),
    reason: 'Playwright/browser configuration',
  },
  {
    matches: file => /^src\/proxy\.(?:ts|tsx|js|jsx)$/.test(file),
    reason: 'navigation proxy behavior',
  },
  {
    matches: file =>
      /^src\/app\/(?:layout|\[locale\]\/layout|\[locale\]\/\(site\)\/layout)\./.test(
        file,
      ),
    reason: 'shared document/layout behavior',
  },
  {
    matches: file => /^src\/components\/navigation\//.test(file),
    reason: 'shared navigation interaction',
  },
  {
    matches: file => /^src\/components\/landing\/hero-section\./.test(file),
    reason: 'landing search interaction',
  },
  {
    matches: file =>
      /^src\/components\/brands\/(?:search-input|sort-select)\./.test(file),
    reason: 'directory search/sort interaction',
  },
  {
    matches: file => /^src\/components\/ui\/native-select\./.test(file),
    reason: 'shared select interaction',
  },
  {
    matches: file => file === CROSS_BROWSER_SPEC,
    reason: 'compatibility journey implementation',
  },
]

/** Files that participate in the import graph. */
export function isCodeFile(file) {
  return CODE_EXTENSIONS.some(extension => file.endsWith(extension))
}

/** An App Router file that defines a route. */
export function isRouteEntrypoint(file) {
  return ROUTE_ENTRYPOINT.test(file)
}

/** A page file that exposes a user-navigable App Router route. */
export function isPageEntrypoint(file) {
  return PAGE_ENTRYPOINT.test(file)
}

/**
 * User-facing route inventory entries. API handlers, metadata handlers, and
 * internal endpoints are intentionally not page files, but keep this guard
 * explicit so a future colocated page cannot silently enter the audit.
 */
export function isUserFacingPageEntrypoint(file) {
  if (!isPageEntrypoint(file)) return false
  const routePath = file.replace(/^src\/app\//, '')
  return !routePath.split('/').some(segment =>
    ['api', 'internal'].includes(segment),
  )
}

/** An App Router file whose route pattern covers every descendant route. */
export function isSubtreeEntrypoint(file) {
  return SUBTREE_ENTRYPOINT.test(file)
}

/** A spec the selective PR job is able to run. */
export function isSelectableSpec(file) {
  return SELECTABLE_SPEC.test(file)
}

/** A Playwright test/describe title carrying an execution-tier tag. */
export function hasTestTag(sourceText, tag) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `(?:test|describe)(?:\\.serial|\\.only)?\\s*\\([^\\n]*${escapedTag}`,
  ).test(sourceText)
}

/**
 * Count tagged test cases without executing a browser project.
 */
export function countTestTags(sourceText, tag) {
  const testCasePattern =
    /\btest(?:\.serial|\.only)?\s*\(\s*(['"])([^\n]*)\1/g
  return [...sourceText.matchAll(testCasePattern)].filter(match =>
    (match[2] ?? '').includes(tag),
  ).length
}

export function isBroadSmokeFallbackFile(file) {
  return BROAD_SMOKE_FALLBACK.some(pattern => pattern.test(file))
}

export function crossBrowserReasons(changedFiles) {
  const reasons = new Set()
  for (const file of changedFiles) {
    for (const trigger of CROSS_BROWSER_TRIGGERS) {
      if (trigger.matches(file)) reasons.add(`${file}: ${trigger.reason}`)
    }
  }
  return [...reasons].sort()
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
    .replace(
      /(?:^|\/)(?:page|layout|route|template|default)\.(?:ts|tsx|js|jsx)$/,
      '',
    )
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
    if (/^\[\[\.\.\.[^\]]+\]\]$/.test(patternSegment)) {
      return index <= concreteSegments.length
    }
    if (/^\[\.\.\.[^\]]+\]$/.test(patternSegment)) {
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
  const specs = files.filter(isSelectableSpec)
  const smokeSpecs = specs.filter(spec =>
    hasTestTag(sourceByFile.get(spec) ?? '', '@smoke'),
  )
  const smokeTestCountBySpec = new Map(
    smokeSpecs.map(spec => [
      spec,
      countTestTags(sourceByFile.get(spec) ?? '', '@smoke'),
    ]),
  )
  const userRouteEntrypoints = files.filter(
    file =>
      isUserFacingPageEntrypoint(file) && sourceByFile.has(file),
  )
  const userRoutes = [
    ...new Set(userRouteEntrypoints.map(routePatternFor)),
  ].sort()
  return {
    reverseGraph,
    routeEntrypoints: files.filter(isRouteEntrypoint),
    pageEntrypoints: files.filter(isPageEntrypoint),
    userRouteEntrypoints,
    userRoutes,
    specs,
    smokeSpecs,
    smokeTestCountBySpec,
    routesBySpec: collectSpecRoutes(
      specs,
      files.filter(file => file.startsWith('e2e/')),
      sourceByFile,
      reverseGraph,
    ),
  }
}

function affectedRoutePatterns(changedFiles, selectionIndex) {
  const reachable = collectReachableImporters(
    changedFiles,
    selectionIndex.reverseGraph,
  )
  const affected = new Set()

  for (const entrypoint of selectionIndex.userRouteEntrypoints) {
    if (reachable.has(entrypoint)) affected.add(routePatternFor(entrypoint))
  }

  const subtreeEntrypoints = selectionIndex.routeEntrypoints.filter(
    entrypoint =>
      isSubtreeEntrypoint(entrypoint) && reachable.has(entrypoint),
  )
  for (const entrypoint of subtreeEntrypoints) {
    const pattern = routePatternFor(entrypoint)
    for (const route of selectionIndex.userRoutes) {
      if (matchesRoute(route, pattern, { subtree: true })) affected.add(route)
    }
  }

  return [...affected].sort()
}

function routeObservedBySpec(observedRoute, routePattern) {
  return matchesRoute(observedRoute, routePattern)
}

/** Return the complete route-family audit used by both CLI and tests. */
export function auditRouteCoverage(selectionIndex) {
  const coverageByRoute = new Map(
    selectionIndex.userRoutes.map(route => [route, []]),
  )
  for (const spec of selectionIndex.smokeSpecs) {
    const observedRoutes = selectionIndex.routesBySpec.get(spec) ?? new Set()
    for (const route of selectionIndex.userRoutes) {
      if (
        [...observedRoutes].some(observedRoute =>
          routeObservedBySpec(observedRoute, route),
        )
      ) {
        coverageByRoute.get(route).push(spec)
      }
    }
  }

  const uncoveredRoutes = [...coverageByRoute]
    .filter(([, specs]) => specs.length === 0)
    .map(([route]) => route)

  return {
    routes: [...selectionIndex.userRoutes],
    coverageByRoute,
    uncovered_routes: uncoveredRoutes,
  }
}

export function selectSelection(changedFiles, selectionIndex) {
  const derivedSpecs = selectDerivedSpecs(changedFiles, selectionIndex)
  const selected = new Set(
    derivedSpecs.filter(spec => selectionIndex.smokeSpecs.includes(spec)),
  )
  for (const spec of selectChangedSpecs(changedFiles)) {
    if (selectionIndex.smokeSpecs.includes(spec)) selected.add(spec)
  }

  const fallback = changedFiles.some(isBroadSmokeFallbackFile)
  let affectedRoutes = affectedRoutePatterns(changedFiles, selectionIndex)
  if (fallback && affectedRoutes.length === 0) {
    affectedRoutes = [...selectionIndex.userRoutes]
  }
  if (fallback) {
    for (const spec of selectionIndex.smokeSpecs) selected.add(spec)
  }

  const audit = auditRouteCoverage(selectionIndex)
  const uncoveredSet = new Set(audit.uncovered_routes)
  const smokeTestCount = [...selected].reduce(
    (total, spec) =>
      total + (selectionIndex.smokeTestCountBySpec.get(spec) ?? 0),
    0,
  )
  return {
    affected_routes: affectedRoutes,
    smoke_specs: [...selected].sort(),
    smoke_test_count: smokeTestCount,
    uncovered_routes: affectedRoutes.filter(route => uncoveredSet.has(route)),
    cross_browser: crossBrowserReasons(changedFiles).length > 0,
    cross_browser_reasons: crossBrowserReasons(changedFiles),
    cross_browser_spec: CROSS_BROWSER_SPEC,
    browser_projects: crossBrowserReasons(changedFiles).length > 0
      ? [...CROSS_BROWSER_PROJECTS]
      : [],
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
  const jsonOutput = process.argv.includes('--json')
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
    if (jsonOutput) {
      process.stdout.write(
        JSON.stringify({
          affected_routes: [],
          smoke_specs: [],
          smoke_test_count: 0,
          uncovered_routes: [],
          cross_browser: false,
          cross_browser_reasons: [],
          cross_browser_spec: CROSS_BROWSER_SPEC,
          browser_projects: [],
        }),
      )
    }
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
  const selection = selectSelection(changedFiles, selectionIndex)

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(selection))
  } else if (selection.smoke_specs.length > 0) {
    process.stdout.write(selection.smoke_specs.join(' '))
  }
}
