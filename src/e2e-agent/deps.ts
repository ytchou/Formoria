/**
 * Production dependency wiring for the e2e nightly agent.
 *
 * Builds real RunnerDeps and E2eSelfHealDeps from environment config
 * and imported adapters.
 */

import { exec } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { getInstallationToken } from '@/lib/adapters/github/app-auth'
import { publish } from '@/lib/adapters/github/app-publish'
import { createTicket } from '@/lib/adapters/linear/create-ticket'
import { postMessage } from '@/lib/adapters/slack/web-api'
import { createRepoWorkerClient } from '@/lib/services/health-agent/repo-worker-client'
import { fetchLangfusePrompt, type PromptName } from '@/lib/langfuse/prompt'
import type { RunnerDeps, ExecResult } from './runner'
import type { E2eSelfHealDeps } from '@/lib/services/e2e-agent/graph'

// ---------------------------------------------------------------------------
// execCommand — wraps child_process.exec with env merging
// ---------------------------------------------------------------------------

function execCommand(
  cmd: string,
  opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = exec(cmd, {
      cwd: opts?.cwd,
      env: opts?.env ? { ...process.env, ...opts.env } : process.env,
      timeout: opts?.timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (d: Buffer | string) => { stdout += String(d) })
    child.stderr?.on('data', (d: Buffer | string) => { stderr += String(d) })

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })

    child.on('error', (err) => {
      resolve({ stdout, stderr: stderr + '\n' + String(err), exitCode: 1 })
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
// cloneAndRunTests — for the validate step of the self-heal graph
// ---------------------------------------------------------------------------

async function cloneAndRunTests(opts: {
  changedFiles: Array<{ path: string; content: string }>
  baseSha: string
  specFiles: string[]
}): Promise<{ passed: boolean; output: string }> {
  const token = await getInstallationToken('clone')
  const targetDir = `/tmp/e2e-validate-${Date.now()}`

  await cloneRepo({
    ref: opts.baseSha,
    shallow: true,
    token,
    targetDir,
  })

  for (const file of opts.changedFiles) {
    const filePath = path.join(targetDir, file.path)
    await mkdir(path.dirname(filePath), { recursive: true })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(filePath, file.content, 'utf-8')
  }

  const install = await execCommand('pnpm install --frozen-lockfile', {
    cwd: targetDir,
    timeoutMs: 3 * 60_000,
    env: { NODE_ENV: 'development' },
  })
  if (install.exitCode !== 0) {
    return { passed: false, output: `install failed: ${install.stderr}` }
  }

  const specArgs = opts.specFiles.length > 0
    ? opts.specFiles.join(' ')
    : ''

  const result = await execCommand(
    `pnpm exec playwright test ${specArgs} --project=deep --reporter=json`,
    {
      cwd: targetDir,
      timeoutMs: 20 * 60_000,
      env: {
        FORMORIA_DEPLOYMENT_ENV: 'staging',
        CI: 'true',
        CF_ACCESS_CLIENT_ID: process.env.CF_ACCESS_CLIENT_ID ?? '',
        CF_ACCESS_CLIENT_SECRET: process.env.CF_ACCESS_CLIENT_SECRET ?? '',
        E2E_STAGING_SESSION_SECRET: process.env.E2E_STAGING_SESSION_SECRET ?? '',
        BASE_URL: process.env.STAGING_BASE_URL ?? 'https://staging.formoria.com',
      },
    },
  )

  let passed = false
  try {
    const report = JSON.parse(result.stdout) as Record<string, unknown>
    const stats = (report.stats ?? {}) as Record<string, unknown>
    passed = Number(stats.unexpected ?? 0) === 0 && result.exitCode === 0
  } catch {
    // JSON parse failure = not passed
  }

  return { passed, output: result.stdout.slice(0, 10_000) }
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

export function buildSelfHealDeps(): E2eSelfHealDeps {
  const workerUrl = process.env.REPO_WORKER_URL
  const workerToken = process.env.REPO_WORKER_TOKEN

  if (!workerUrl) {
    throw new Error('REPO_WORKER_URL is required for self-heal')
  }

  return {
    createClient: (deadlineMs: number) =>
      createRepoWorkerClient(
        {
          baseUrl: workerUrl,
          token: workerToken,
          getCloneToken: () => getInstallationToken('clone'),
        },
        { deadlineMs },
      ),
    fetchPrompt: (name: string) =>
      fetchLangfusePrompt(name as PromptName),
    publish,
    createTicket,
    postSlackMessage: postMessage,
    cloneAndRunTests,
  }
}
