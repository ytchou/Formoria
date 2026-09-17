/**
 * Server import test — verifies that the health-agent entry modules can be
 * imported in plain Node without Next.js server-only invariant errors.
 *
 * Uses child_process to spawn a fresh Node process so that the import graph
 * is evaluated from scratch, independent of Vitest's module cache.
 */

import { execFile } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('health-agent entry modules', () => {
  it('registry imports in plain Node without server-only errors', async () => {
    const result = await spawnNodeImport(
      'import("./src/lib/services/health-agent/registry.ts").then(() => console.log("registry loaded"))',
    )
    expect(result.code, `stderr: ${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('registry loaded')
  })

  it('run module imports in plain Node without server-only errors', async () => {
    const result = await spawnNodeImport(
      'import("./src/lib/services/health-agent/run.ts").then(() => console.log("run loaded"))',
    )
    expect(result.code, `stderr: ${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('run loaded')
  })
})

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function spawnNodeImport(
  code: string,
): Promise<{ code: string | number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', '-e', code],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'test-key',
        },
      },
      (error, stdout, stderr) =>
        resolve({
          code: error?.code ?? 0,
          stdout,
          stderr,
        }),
    )
  })
}
