#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const serviceRegistryRoots = ['src', 'scripts']

const sourceExtension = /\.[cm]?[jt]sx?$/
const credentialEnvName =
  /(?:_API_KEY|_TOKEN|_SECRET|_DSN|_URL|_KEY|_WEBHOOK_URL)$/
const envReference = /process\.env\.([A-Z][A-Z0-9_]*)/g
const exemptFiles = [
  'scripts/check-service-registry.mjs',
  'scripts/check-service-registry.test.ts',
]
const STALE_PLAN_DAYS = 180

function collectSourceFiles(cwd, root) {
  const absoluteRoot = join(cwd, root)
  if (!existsSync(absoluteRoot)) return []

  const files = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    for (const entry of readdirSync(join(cwd, current), {
      withFileTypes: true,
    })) {
      if (entry.name === '.next' || entry.name === 'node_modules') continue

      const child = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(child)
        continue
      }

      if (entry.isFile() && sourceExtension.test(entry.name)) files.push(child)
    }
  }

  return files.sort()
}

function parseStringList(source) {
  return [...source.matchAll(/['"]([A-Z][A-Z0-9_]*)['"]/g)].map(
    (match) => match[1],
  )
}

export function parseServiceRegistrySource(source) {
  const entries = []
  const registryStart = source.indexOf('SERVICE_REGISTRY')
  const registrySource = registryStart >= 0 ? source.slice(registryStart) : ''
  const entryStarts = [
    ...registrySource.matchAll(/\{\s*id:\s*['"]([^'"]+)['"]/g),
  ]
  const dateConstants = new Map(
    [
      ...source.matchAll(
        /(?:const|let)\s+([A-Z][A-Z0-9_]*)\s*=\s*['"](\d{4}-\d{2}-\d{2})['"]/g,
      ),
    ].map((match) => [match[1], match[2]]),
  )

  for (let index = 0; index < entryStarts.length; index += 1) {
    const entryStart = entryStarts[index].index ?? 0
    const nextStart = entryStarts[index + 1]?.index ?? registrySource.length
    const entrySource = registrySource.slice(entryStart, nextStart)
    const envVarsMatch = entrySource.match(/envVars\s*:\s*\[([\s\S]*?)\]/)
    const asOfMatch = entrySource.match(
      /plan\s*:\s*\{[\s\S]*?\basOf\s*:\s*(['"]([^'"]+)['"]|([A-Z][A-Z0-9_]*))/,
    )
    const asOf = asOfMatch
      ? (asOfMatch[2] ?? dateConstants.get(asOfMatch[3]) ?? null)
      : null

    entries.push({
      id: entryStarts[index][1],
      envVars: envVarsMatch ? parseStringList(envVarsMatch[1]) : [],
      asOf,
    })
  }

  const nonServiceStart = source.indexOf('NON_SERVICE_ENV')
  const nonServiceSource =
    nonServiceStart >= 0 ? source.slice(nonServiceStart) : ''
  const nonServiceBody = nonServiceSource.match(/=\s*\{([\s\S]*?)\}/)?.[1] ?? ''

  return {
    entries,
    envVars: new Set(entries.flatMap((entry) => entry.envVars)),
    nonServiceEnv: new Set(
      [...nonServiceBody.matchAll(/\b([A-Z][A-Z0-9_]*)\s*:/g)].map(
        (match) => match[1],
      ),
    ),
  }
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length
}

function stalePlanViolation(entry, registrySource, now) {
  if (!entry.asOf) return null

  const parsed = Date.parse(`${entry.asOf}T00:00:00Z`)
  if (!Number.isFinite(parsed)) return null

  const ageDays = (now.getTime() - parsed) / (24 * 60 * 60 * 1000)
  if (ageDays <= STALE_PLAN_DAYS) return null

  const entryIndex = registrySource.indexOf(`id: '${entry.id}'`)
  return {
    type: 'stale-plan',
    name: entry.id,
    asOf: entry.asOf,
    file: 'src/lib/services/service-registry.ts',
    line: entryIndex >= 0 ? lineNumber(registrySource, entryIndex) : 1,
    message: `Refresh the plan.asOf date for ${entry.id}; it is older than ${STALE_PLAN_DAYS} days.`,
  }
}

export function collectServiceRegistryViolations({
  cwd = process.cwd(),
  roots = serviceRegistryRoots,
  registrySource = readFileSync(
    join(cwd, 'src/lib/services/service-registry.ts'),
    'utf8',
  ),
  now = new Date(),
} = {}) {
  const parsed = parseServiceRegistrySource(registrySource)
  const violations = parsed.entries
    .map((entry) => stalePlanViolation(entry, registrySource, now))
    .filter(Boolean)

  for (const file of roots.flatMap((root) => collectSourceFiles(cwd, root))) {
    const normalized = file.replaceAll('\\', '/')
    if (exemptFiles.includes(normalized)) continue

    const source = readFileSync(join(cwd, file), 'utf8')
    for (const match of source.matchAll(envReference)) {
      const name = match[1]
      if (!credentialEnvName.test(name)) continue
      if (parsed.envVars.has(name) || parsed.nonServiceEnv.has(name)) continue

      violations.push({
        type: 'unknown-env',
        name,
        file: normalized,
        line: lineNumber(source, match.index ?? 0),
        message: `Unknown credential env var ${name}. Remedy: add to a registry entry's envVars, or to NON_SERVICE_ENV with a reason.`,
      })
    }
  }

  return violations
}

export function reportServiceRegistryViolations(violations) {
  if (violations.length > 0) {
    console.error('Service registry coverage guard failed:')
    for (const violation of violations) {
      console.error(
        `${violation.file}:${violation.line} - ${violation.message}`,
      )
    }
    return 1
  }

  console.log('Service registry coverage guard passed.')
  return 0
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = reportServiceRegistryViolations(
    collectServiceRegistryViolations(),
  )
}
