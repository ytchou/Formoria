/**
 * Production dependency wiring for the e2e nightly agent.
 *
 * Builds real RunnerDeps from environment config.
 */

import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import type { RunnerDeps, ExecResult } from './runner'

// ---------------------------------------------------------------------------
// execCommand — wraps child_process.spawn (shell) with env merging
//
// The timeout is enforced here, not via a child_process `timeout` option, so
// the result can report `timedOut` and the runner can tell a killed run from
// a failed one (DEV-1853). Output is accumulated manually, so there is no
// maxBuffer cap that could kill the child and masquerade as a failure.
// ---------------------------------------------------------------------------

const KILL_GRACE_MS = 10_000

// Signal the child's whole process group. The `/bin/sh -c` wrapper does not
// forward signals, so killing only the wrapper leaves pnpm -> playwright ->
// chromium alive and holding the stdout pipe open, which delays 'close'.
// `detached: true` at spawn makes the child a group leader (pgid === pid).
function killGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // ESRCH: group already gone — fall through to the direct kill
    }
  }
  child.kill(signal)
}

function execCommand(
  cmd: string,
  opts?: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
    streamOutput?: boolean
  },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    // Not unref()'d: the parent must keep waiting on the detached child.
    const child = spawn(cmd, {
      shell: true,
      cwd: opts?.cwd,
      env: opts?.env ? { ...process.env, ...opts.env } : process.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let killTimer: NodeJS.Timeout | undefined

    const timer = opts?.timeoutMs
      ? setTimeout(() => {
        // The child may have exited in this same tick; 'close' will report it.
        if (child.exitCode !== null || child.signalCode !== null) return
        timedOut = true
        killGroup(child, 'SIGTERM')
        killTimer = setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS)
      }, opts.timeoutMs)
      : undefined

    const clearTimers = (): void => {
      clearTimeout(timer)
      clearTimeout(killTimer)
    }

    child.stdout?.on('data', (d: Buffer | string) => {
      const chunk = String(d)
      stdout += chunk
      if (opts?.streamOutput) process.stdout.write(chunk)
    })
    child.stderr?.on('data', (d: Buffer | string) => {
      const chunk = String(d)
      stderr += chunk
      if (opts?.streamOutput) process.stderr.write(chunk)
    })

    child.on('close', (code) => {
      clearTimers()
      resolve({ stdout, stderr, exitCode: code ?? 1, timedOut })
    })

    child.on('error', (err) => {
      clearTimers()
      resolve({ stdout, stderr: stderr + '\n' + String(err), exitCode: 1, timedOut })
    })
  })
}

// ---------------------------------------------------------------------------
// cloneRepo — shallow git clone using token auth
// ---------------------------------------------------------------------------

async function cloneRepo(opts: {
  ref: string
  shallow: boolean
  token: string
  targetDir: string
}): Promise<string> {
  await mkdir(opts.targetDir, { recursive: true })
  const repo = process.env.GITHUB_APP_REPOSITORY ?? 'ytchou/Formoria'
  const url = `https://x-access-token:${opts.token}@github.com/${repo}.git`

  const depthFlag = opts.shallow ? '--depth=1' : ''
  const result = await execCommand(
    `git clone ${depthFlag} --branch staging --single-branch ${url} ${opts.targetDir}`,
  )
  if (result.exitCode !== 0) {
    throw new Error(`git clone failed: ${result.stderr}`)
  }

  const checkout = await execCommand(
    `git checkout ${opts.ref}`,
    { cwd: opts.targetDir },
  )
  if (checkout.exitCode !== 0) {
    throw new Error(`git checkout ${opts.ref} failed: ${checkout.stderr}`)
  }

  return opts.targetDir
}

// ---------------------------------------------------------------------------
// fetchRevision — polls the X-Formoria-Revision header from staging
// ---------------------------------------------------------------------------

async function fetchRevision(stagingUrl: string): Promise<string> {
  const cfClientId = process.env.CF_ACCESS_CLIENT_ID ?? ''
  const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET ?? ''

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  }
  if (cfClientId && cfClientSecret) {
    headers['CF-Access-Client-Id'] = cfClientId
    headers['CF-Access-Client-Secret'] = cfClientSecret
  }

  const res = await fetch(stagingUrl, {
    method: 'HEAD',
    headers,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)

  return res?.headers.get('X-Formoria-Revision') ?? ''
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildRunnerDeps(): RunnerDeps {
  return {
    execCommand,
    cloneRepo,
    fetchRevision,
  }
}
