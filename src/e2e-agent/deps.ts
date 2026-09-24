/**
 * Production dependency wiring for the e2e nightly agent.
 *
 * Builds real RunnerDeps from environment config.
 */

import { exec } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import type { RunnerDeps, ExecResult } from './runner'

// ---------------------------------------------------------------------------
// execCommand — wraps child_process.exec with env merging
//
// The timeout is enforced here, not via exec's `timeout` option, so the
// result can report `timedOut` and the runner can tell a killed run from a
// failed one (DEV-1853).
// ---------------------------------------------------------------------------

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
    const child = exec(cmd, {
      cwd: opts?.cwd,
      env: opts?.env ? { ...process.env, ...opts.env } : process.env,
      maxBuffer: 50 * 1024 * 1024,
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = opts?.timeoutMs
      ? setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, opts.timeoutMs)
      : undefined

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
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code ?? 1, timedOut })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
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
