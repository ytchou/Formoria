import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

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

// CLI entry point — only runs when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const routeMap = JSON.parse(
    readFileSync(join(__dirname, 'e2e-route-map.json'), 'utf8')
  )

  let changedFiles = []
  try {
    changedFiles = execSync('git diff --name-only origin/main...HEAD', {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
  } catch {
    // No git history or detached HEAD — output nothing and exit cleanly
    process.exit(0)
  }

  const specs = selectSpecs(changedFiles, routeMap)
  if (specs.length > 0) {
    process.stdout.write(specs.join(' '))
  }
}
