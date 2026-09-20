/**
 * Repo worker HTTP client — sends repair jobs to the repo-worker service and
 * polls for completion.
 *
 * Transport is configuration: base URL from `REPO_WORKER_URL`, Authorization
 * header sent only when `REPO_WORKER_TOKEN` is set. Every job receives a
 * freshly minted read-only clone token from the GitHub App.
 *
 * Never throws: every error path returns a typed result so the caller can
 * surface a finding instead of crashing the health run.
 */

import type {
  ChangedFile,
  CommandResult,
  JobErrorStage,
} from '@/repo-worker/jobs'
import type { AgentRequest, AgentResult } from '@/repo-worker/agent'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RepoWorkerJobRequest = {
  ref: string
  commands: Array<{ id: string; run: string; timeoutMs: number }>
  editableFiles: string[]
  blockedFiles?: string[]
  inputFiles?: ChangedFile[]
  agent?: AgentRequest
  claude?: {
    prompt: string
    allowedTools: string[]
    maxTurns: number
    jsonSchema: object
    resumeSessionId?: string
  }
}

type RepoWorkerJobResult = {
  status: 'done' | 'error'
  results?: CommandResult[]
  changedFiles?: ChangedFile[]
  revertedFiles?: string[]
  baseSha?: string
  agent?: AgentResult
  claude?: {
    structuredOutput: unknown
    sessionId: string | undefined
    costUsd: number | undefined
  }
  error?: string
  errorCode?: string
  errorStage?: JobErrorStage | 'clone-auth' | 'transport'
}

export type RepoWorkerClientDeps = {
  baseUrl: string
  token?: string
  getCloneToken: () => Promise<string>
}

export type RepoWorkerClientOptions = {
  /** Override fetch for tests. */
  fetchFn?: typeof fetch
  /** Absolute deadline in ms from now. Defaults to 300_000 (5 min). */
  deadlineMs?: number
  /** Poll interval in ms. Defaults to 30_000. */
  pollIntervalMs?: number
  /** Base retry backoff in ms. Defaults to 2_000. */
  retryBaseMs?: number
}

export type RepoWorkerClient = {
  run: (request: RepoWorkerJobRequest) => Promise<RepoWorkerJobResult>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DEADLINE_MS = 300_000
const DEFAULT_POLL_INTERVAL_MS = 30_000
const DEFAULT_RETRY_BASE_MS = 2_000
const MAX_SUBMIT_RETRIES = 3

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRepoWorkerClient(
  deps: RepoWorkerClientDeps,
  opts: RepoWorkerClientOptions = {},
): RepoWorkerClient {
  const fetchFn = opts.fetchFn ?? globalThis.fetch
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const retryBaseMs = opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS

  function headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (deps.token) {
      h['Authorization'] = `Bearer ${deps.token}`
    }
    return h
  }

  async function submitJob(
    request: RepoWorkerJobRequest,
    cloneToken: string,
    deadline: number,
  ): Promise<{ jobId: string } | RepoWorkerJobResult> {
    const body = JSON.stringify({
      ref: request.ref,
      cloneToken,
      commands: request.commands,
      editableFiles: request.editableFiles,
      ...(request.inputFiles ? { inputFiles: request.inputFiles } : {}),
      ...(request.agent ? { agent: request.agent } : {}),
      ...(request.claude ? { claude: request.claude } : {}),
      ...(request.blockedFiles ? { blockedFiles: request.blockedFiles } : {}),
    })

    for (let attempt = 0; attempt < MAX_SUBMIT_RETRIES; attempt++) {
      if (Date.now() >= deadline) {
        return {
          status: 'error',
          errorCode: 'repo-worker-unreachable',
          errorStage: 'transport',
          error: 'Deadline exceeded before job could be submitted',
        }
      }

      try {
        const response = await fetchFn(`${deps.baseUrl}/run`, {
          method: 'POST',
          headers: headers(),
          body,
        })

        if (response.status === 202) {
          const data = (await response.json()) as { jobId: string }
          return { jobId: data.jobId }
        }

        if (response.status >= 500) {
          // Retry on 5xx
          if (attempt < MAX_SUBMIT_RETRIES - 1 && Date.now() < deadline) {
            await sleep(retryBaseMs * (attempt + 1))
            continue
          }
          return {
            status: 'error',
            errorCode: 'repo-worker-unreachable',
            errorStage: 'transport',
            error: `Worker returned ${response.status}`,
          }
        }

        // 4xx — not retryable
        const errorBody = await response.text().catch(() => '')
        return {
          status: 'error',
          errorCode: 'repo-worker-rejected',
          errorStage: 'transport',
          error: `Worker returned ${response.status}: ${errorBody}`,
        }
      } catch {
        // Connection refused or network error — retry
        if (attempt < MAX_SUBMIT_RETRIES - 1 && Date.now() < deadline) {
          await sleep(retryBaseMs * (attempt + 1))
          continue
        }
        return {
          status: 'error',
          errorCode: 'repo-worker-unreachable',
          errorStage: 'transport',
          error: 'Connection failed after retries',
        }
      }
    }

    return {
      status: 'error',
      errorCode: 'repo-worker-unreachable',
      errorStage: 'transport',
      error: 'Max retries exceeded',
    }
  }

  async function pollJob(
    jobId: string,
    deadline: number,
  ): Promise<RepoWorkerJobResult> {
    while (Date.now() < deadline) {
      try {
        const response = await fetchFn(`${deps.baseUrl}/jobs/${jobId}`, {
          method: 'GET',
          headers: headers(),
        })

        if (!response.ok) {
          return {
            status: 'error',
            errorCode: 'poll-failed',
            errorStage: 'transport',
            error: `Poll returned ${response.status}`,
          }
        }

        const data = (await response.json()) as Record<string, unknown>

        if (data.status === 'done' || data.status === 'failed') {
          return {
            status: data.status === 'done' ? 'done' : 'error',
            results: data.results as CommandResult[] | undefined,
            changedFiles: data.changedFiles as ChangedFile[] | undefined,
            revertedFiles: data.revertedFiles as string[] | undefined,
            baseSha: data.baseSha as string | undefined,
            agent: data.agent as RepoWorkerJobResult['agent'],
            claude: data.claude as RepoWorkerJobResult['claude'],
            error: data.error as string | undefined,
            errorCode:
              data.status === 'failed'
                ? ((data.errorCode as string | undefined) ?? 'job-failed')
                : undefined,
            errorStage: data.errorStage as RepoWorkerJobResult['errorStage'],
          }
        }

        // Still running — wait and poll again
        await sleep(pollIntervalMs)
      } catch {
        // Network error during poll — wait and retry
        await sleep(pollIntervalMs)
      }
    }

    return {
      status: 'error',
      errorCode: 'job-deadline-exceeded',
      errorStage: 'transport',
      error: `Job ${jobId} did not complete within deadline`,
    }
  }

  return {
    async run(request) {
      const deadline = Date.now() + deadlineMs

      // Mint a fresh clone token for every job
      let cloneToken: string
      try {
        cloneToken = await deps.getCloneToken()
      } catch (err) {
        return {
          status: 'error',
          errorCode: 'clone-token-failed',
          errorStage: 'clone-auth',
          error: err instanceof Error ? err.message : String(err),
        }
      }

      const submitResult = await submitJob(request, cloneToken, deadline)

      if ('status' in submitResult && submitResult.status === 'error') {
        return submitResult as RepoWorkerJobResult
      }

      const { jobId } = submitResult as { jobId: string }
      return pollJob(jobId, deadline)
    },
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
