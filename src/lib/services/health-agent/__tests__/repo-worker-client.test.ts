import { describe, expect, it, vi, beforeEach } from 'vitest'

import {
  createRepoWorkerClient,
  type RepoWorkerClientDeps,
  type RepoWorkerJobRequest,
} from '../repo-worker-client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<RepoWorkerClientDeps> = {}): RepoWorkerClientDeps {
  return {
    baseUrl: 'http://localhost:8080',
    getCloneToken: vi.fn().mockResolvedValue('ghs_test-token'),
    ...overrides,
  }
}

function makeRequest(overrides: Partial<RepoWorkerJobRequest> = {}): RepoWorkerJobRequest {
  return {
    ref: 'staging',
    commands: [{ id: 'lint', run: 'pnpm lint', timeoutMs: 60_000 }],
    editableFiles: ['src/app.ts'],
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('repo-worker-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('run retries on 502 and connection refused with backoff and gives up after the deadline with repo-worker-unreachable', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    // First call: 502
    fetchMock.mockResolvedValueOnce(jsonResponse(502, { error: 'Bad Gateway' }))
    // Second call: connection refused (fetch throws)
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    // Third call: also fails
    fetchMock.mockResolvedValueOnce(jsonResponse(502, { error: 'Bad Gateway' }))

    const deps = makeDeps()
    const client = createRepoWorkerClient(deps, {
      fetchFn: fetchMock,
      // Very short deadline to force early give-up
      deadlineMs: 50,
      retryBaseMs: 5,
    })

    const result = await client.run(makeRequest())

    expect(result.status).toBe('error')
    expect(result.errorCode).toBe('repo-worker-unreachable')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('polls every 30 seconds and returns the result when status is done', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

    // POST /run -> accepted with jobId
    fetchMock.mockResolvedValueOnce(
      jsonResponse(202, { jobId: 'job-123' }),
    )
    // GET /jobs/job-123 -> still running
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: 'running' }),
    )
    // GET /jobs/job-123 -> done
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: 'done',
        results: [{ id: 'lint', exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }],
        changedFiles: [{ path: 'src/app.ts', content: 'fixed' }],
      }),
    )

    const deps = makeDeps()
    const client = createRepoWorkerClient(deps, {
      fetchFn: fetchMock,
      deadlineMs: 120_000,
      pollIntervalMs: 10, // short for test
    })

    const result = await client.run(makeRequest())

    expect(result.status).toBe('done')
    expect(result.results).toHaveLength(1)
    expect(result.changedFiles).toHaveLength(1)

    // Verify the poll URL
    const pollCalls = fetchMock.mock.calls.filter(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('/jobs/'),
    )
    expect(pollCalls.length).toBe(2)
    expect(pollCalls[0]![0]).toBe('http://localhost:8080/jobs/job-123')
  })

  it('sends and returns the provider-neutral agent contract', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse(202, { jobId: 'job-agent' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        status: 'done',
        agent: {
          structuredOutput: { status: 'diagnosed' },
          sessionId: 'thread-123',
          usage: { input_tokens: 120, output_tokens: 24 },
        },
      }))

    const client = createRepoWorkerClient(makeDeps(), {
      fetchFn: fetchMock,
      deadlineMs: 120_000,
      pollIntervalMs: 5,
    })
    const request = makeRequest({
      agent: {
        prompt: 'Diagnose the failure',
        access: 'read',
        jsonSchema: { type: 'object' },
      },
    })

    const result = await client.run(request)
    const postBody = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    )

    expect(postBody.agent).toEqual(request.agent)
    expect(result.agent).toEqual({
      structuredOutput: { status: 'diagnosed' },
      sessionId: 'thread-123',
      usage: { input_tokens: 120, output_tokens: 24 },
    })
  })

  it('sends blocked paths and returns reverted files', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse(202, { jobId: 'job-policy' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        status: 'done',
        revertedFiles: ['.github/workflows/unsafe.yml'],
      }))
    const client = createRepoWorkerClient(makeDeps(), {
      fetchFn: fetchMock,
      deadlineMs: 120_000,
      pollIntervalMs: 5,
    })

    const result = await client.run(makeRequest({
      editableFiles: ['**/*'],
      blockedFiles: ['.github/**'],
    }))
    const postBody = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    )

    expect(postBody.blockedFiles).toEqual(['.github/**'])
    expect(result.revertedFiles).toEqual(['.github/workflows/unsafe.yml'])
  })

  it('sends prior patch files for validation in a fresh clone', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse(202, { jobId: 'job-validation' }))
      .mockResolvedValueOnce(jsonResponse(200, { status: 'done', results: [] }))
    const inputFiles = [{ path: 'src/app.ts', content: 'export const fixed = true' }]
    const client = createRepoWorkerClient(makeDeps(), {
      fetchFn: fetchMock,
      deadlineMs: 120_000,
      pollIntervalMs: 5,
    })

    await client.run(makeRequest({ inputFiles }))

    const postBody = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    )
    expect(postBody.inputFiles).toEqual(inputFiles)
  })

  it('a job still running at the deadline becomes a finding not a throw', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

    // POST /run -> accepted
    fetchMock.mockResolvedValueOnce(
      jsonResponse(202, { jobId: 'job-timeout' }),
    )
    // All polls return running
    fetchMock.mockResolvedValue(
      jsonResponse(200, { status: 'running' }),
    )

    const deps = makeDeps()
    const client = createRepoWorkerClient(deps, {
      fetchFn: fetchMock,
      deadlineMs: 50,
      pollIntervalMs: 5,
    })

    const result = await client.run(makeRequest())

    // Should not throw — returns a result with error status
    expect(result.status).toBe('error')
    expect(result.errorCode).toBe('job-deadline-exceeded')
  })

  it('preserves worker failure stage and code returned by polling', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse(202, { jobId: 'job-install-failed' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        status: 'failed',
        error: 'Dependency installation failed',
        errorStage: 'install',
        errorCode: 'install-failed',
      }))

    const client = createRepoWorkerClient(makeDeps(), {
      fetchFn: fetchMock,
      deadlineMs: 120_000,
      pollIntervalMs: 5,
    })

    await expect(client.run(makeRequest())).resolves.toMatchObject({
      status: 'error',
      error: 'Dependency installation failed',
      errorStage: 'install',
      errorCode: 'install-failed',
    })
  })

  it('every job is sent a freshly minted read-only clone token', async () => {
    const getCloneToken = vi.fn()
      .mockResolvedValueOnce('ghs_token-1')
      .mockResolvedValueOnce('ghs_token-2')

    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    // First run
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { jobId: 'job-1' }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: 'done', results: [] }),
    )
    // Second run
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { jobId: 'job-2' }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: 'done', results: [] }),
    )

    const deps = makeDeps({ getCloneToken })
    const client = createRepoWorkerClient(deps, {
      fetchFn: fetchMock,
      deadlineMs: 120_000,
      pollIntervalMs: 5,
    })

    await client.run(makeRequest())
    await client.run(makeRequest())

    expect(getCloneToken).toHaveBeenCalledTimes(2)

    // Verify both POST bodies carry different tokens
    const postCalls = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    )
    expect(postCalls).toHaveLength(2)
    const body1 = JSON.parse((postCalls[0]![1] as RequestInit).body as string)
    const body2 = JSON.parse((postCalls[1]![1] as RequestInit).body as string)
    expect(body1.cloneToken).toBe('ghs_token-1')
    expect(body2.cloneToken).toBe('ghs_token-2')
  })

  it('sends Authorization header only when token is set', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { jobId: 'j' }))
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'done', results: [] }))

    const deps = makeDeps({ token: 'worker-secret' })
    const client = createRepoWorkerClient(deps, {
      fetchFn: fetchMock,
      deadlineMs: 120_000,
      pollIntervalMs: 5,
    })

    await client.run(makeRequest())

    const postCall = fetchMock.mock.calls[0]!
    const headers = (postCall[1] as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer worker-secret')
  })

  it('omits Authorization header when no token is configured', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { jobId: 'j' }))
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'done', results: [] }))

    const deps = makeDeps() // no token
    const client = createRepoWorkerClient(deps, {
      fetchFn: fetchMock,
      deadlineMs: 120_000,
      pollIntervalMs: 5,
    })

    await client.run(makeRequest())

    const postCall = fetchMock.mock.calls[0]!
    const headers = (postCall[1] as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })
})
