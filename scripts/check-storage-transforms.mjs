#!/usr/bin/env node
/**
 * @formoria-script
 * purpose: Fails the build on any use of Supabase Storage's metered image-transformation endpoint.
 * class: ci-gate
 * invoke: pnpm check:storage-transforms
 * target: none
 * safety: read-only
 * owner: engineering
 */
// CI guard: nothing may reach Supabase Storage's image-transformation endpoint.
//
// DEV-1374 (2026-08-07): the single caller that built `/storage/v1/render/image`
// URLs for the vision classifier ran up 14,701 transformations against a monthly
// quota of 100. With the org spend cap on, Supabase restricted the project and
// production went down. The vision path now encodes its own derivatives in
// process (src/lib/services/vision-image.ts), so any new use of the metered
// endpoint is a regression, not a trade-off.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const storageTransformRoots = ['src', 'scripts', 'supabase/functions']

/** This guard and its test necessarily contain the strings they look for. */
const exemptFiles = [
  'scripts/check-storage-transforms.mjs',
  'scripts/check-storage-transforms.test.ts',
]

export const storageTransformChecks = [
  {
    name: 'render endpoint URL',
    // Matches both the literal path and the form assembled from a bucket
    // segment, which is how the deleted brandImageRenderUrl built it.
    pattern: /\/storage\/v1\/render\/image|render\/image\/public\//g,
  },
  {
    // supabase-js hits the same metered endpoint without any URL literal
    // appearing in source, so a URL-only regex would miss it entirely.
    // `download` belongs here as much as the URL builders do: supabase-js routes
    // a transform option on it through the same /render/image endpoint, and the
    // vision path this guard exists to protect is itself a `download` caller —
    // so that is the most likely site of the next regression.
    //
    // The window between the call and `transform:` excludes `)`, `}` and `;`,
    // which keeps the match inside the call's own argument list. Scanning a flat
    // 400 characters instead flagged `getPublicUrl(key)` followed by an
    // unrelated CSS `{ transform: 'rotate(1deg)' }`, i.e. it failed lint on a
    // file that touches no metered endpoint.
    //
    // KNOWN LIMIT: options passed by reference (`.download(key, opts)` with
    // `transform` set on `opts` elsewhere) are invisible to any regex. Static
    // shapes are what a guard can hold; the runbook is the backstop for the rest.
    name: 'transform option on a storage URL call',
    pattern:
      /\.(?:getPublicUrl|createSignedUrls?|download)\s*\(\s*[^)};]{0,200}?\btransform\s*:/g,
  },
]

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

      // Every JS/TS extension we can execute, not just the three the repo
      // happens to use today: a guard that stops at `.mjs` invites the
      // regression to land in a `.js` build script and pass.
      if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
        files.push(child)
      }
    }
  }

  return files.sort()
}

export function collectStorageTransformFailures({
  cwd = process.cwd(),
  roots = storageTransformRoots,
} = {}) {
  const files = roots.flatMap((root) => collectSourceFiles(cwd, root))
  const failures = []

  for (const file of files) {
    const normalized = file.replaceAll('\\', '/')
    if (exemptFiles.includes(normalized)) continue

    const source = readFileSync(join(cwd, file), 'utf8')

    for (const check of storageTransformChecks) {
      for (const match of source.matchAll(check.pattern)) {
        failures.push({
          file: normalized,
          line: source.slice(0, match.index).split('\n').length,
          name: check.name,
          value: match[0].replace(/\s+/g, ' ').slice(0, 80),
        })
      }
    }
  }

  return failures
}

export function reportStorageTransformFailures(failures) {
  if (failures.length > 0) {
    console.error('Supabase Storage image-transformation guard failed:')
    for (const failure of failures) {
      console.error(
        `${failure.file}:${failure.line} - ${failure.name}: ${failure.value}`,
      )
    }
    console.error(
      'DEV-1374: the transformation endpoint is quota-metered at 100/month and took production down at 14,701. Downscale in process with visionDataUri from src/lib/services/vision-image.ts instead.',
    )
    return 1
  }

  console.log('Supabase Storage image-transformation guard passed.')
  return 0
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = reportStorageTransformFailures(
    collectStorageTransformFailures(),
  )
}
