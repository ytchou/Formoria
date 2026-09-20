import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CompiledStateGraph } from '@langchain/langgraph'

import {
  buildRepairGraph,
  runRepairAgent,
  HEALTH_REPAIR_RECURSION_LIMIT,
  type RepairInput,
  type RepairDeps,
} from '../graph'

// ---------------------------------------------------------------------------
// Langfuse prompt spy — boundary checker allows mocking @/lib/langfuse/*
// (same pattern as products graph test).
// ---------------------------------------------------------------------------

const promptCalls: Array<[string, Record<string, string> | undefined]> = []
vi.mock('@/lib/langfuse/prompt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/langfuse/prompt')>()
  return {
    ...actual,
    fetchLangfusePromptWithMeta: vi.fn(
      async (name: string, variables?: Record<string, string>) => {
        promptCalls.push([name, variables])
        return actual.fetchLangfusePromptWithMeta(
          name as import('@/lib/langfuse/prompt').PromptName,
          variables,
        )
      },
    ),
    fetchLangfusePrompt: vi.fn(
      async (name: string, variables?: Record<string, string>) => {
        return actual.fetchLangfusePrompt(
          name as import('@/lib/langfuse/prompt').PromptName,
          variables,
        )
      },
    ),
  }
})

beforeAll(() => {
  vi.stubEnv('LANGFUSE_PUBLIC_KEY', '')
  vi.stubEnv('LANGFUSE_SECRET_KEY', '')
  vi.stubEnv('LANGFUSE_HOST', '')
})

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeProblem(overrides: Partial<RepairInput['problems'][number]> = {}) {
  return {
    fingerprint: 'quality:dead-code:src/lib/utils.ts:unusedFn',
    source: 'quality',
    title: 'Knip exports: unusedFn',
    evidence: { check: 'dead-code', file: 'src/lib/utils.ts' },
    changedFiles: ['src/lib/utils.ts'],
    mergePolicy: 'automatic' as const,
    ...overrides,
  }
}

function makeInput(overrides: Partial<RepairInput> = {}): RepairInput {
  return {
    problems: [makeProblem()],
    ref: 'staging',
    ...overrides,
  }
}

function makeDeps(overrides: Partial<RepairDeps> = {}): RepairDeps {
  return {
    runJob: vi.fn().mockResolvedValue({
      status: 'done',
      results: [
        { id: 'vitest', exitCode: 0, stdout: '', stderr: '', timedOut: false },
      ],
      changedFiles: [{ path: 'src/lib/utils.ts', content: 'fixed code' }],
      agent: {
        structuredOutput: {
          snapshot_id: 'snap-1',
          cycle: 1,
          status: 'ready_to_merge',
          validation_state: 'passed',
          review_state: 'passed',
          fixed: true,
          merged: false,
          findings: [
            {
              fingerprint: 'quality:dead-code:src/lib/utils.ts:unusedFn',
              status: 'ready_to_merge',
              changed_files: ['src/lib/utils.ts'],
              summary: 'Removed unused export',
            },
          ],
        },
        sessionId: 'session-abc',
        usage: { input_tokens: 100, output_tokens: 20 },
      },
    }),
    fetchPrompt: vi.fn().mockResolvedValue({
      text: 'You are the repair investigator.',
      prompt: {
        name: 'health-investigator',
        version: 1,
        source: 'snapshot' as const,
      },
    }),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('repair agent graph', () => {
  it('graph shape: investigate -> validate -> resume | finalize', () => {
    expect(HEALTH_REPAIR_RECURSION_LIMIT).toBeGreaterThan(0)

    const compiled = buildRepairGraph(makeDeps())
    expect(compiled).toBeInstanceOf(CompiledStateGraph)

    const drawn = compiled.getGraph()
    const nodeNames = Object.keys(drawn.nodes)

    expect(nodeNames).toEqual(
      expect.arrayContaining(['investigate', 'validate', 'finalize']),
    )

    // investigate -> validate (unconditional or conditional)
    const investigateEdges = drawn.edges.filter(
      (e) => e.source === 'investigate',
    )
    expect(investigateEdges.length).toBeGreaterThan(0)

    // validate has conditional edges: resume or finalize
    const validateEdges = drawn.edges.filter((e) => e.source === 'validate')
    expect(validateEdges.length).toBeGreaterThan(0)

    // finalize leads to __end__
    const finalizeEdges = drawn.edges.filter((e) => e.source === 'finalize')
    expect(finalizeEdges.some((e) => e.target === '__end__')).toBe(true)
  })

  it('a passing patch ends patched with changedFiles from the investigator', async () => {
    const deps = makeDeps()
    const result = await runRepairAgent(makeInput(), deps)

    expect(result.agentOutcome).toBe('patched')
    expect(result.changedFiles).toBeDefined()
    expect(result.changedFiles!.length).toBeGreaterThan(0)
    expect(result.changedFiles![0]!.path).toBe('src/lib/utils.ts')
  })

  it('a failing validation resumes the same session id once and passes', async () => {
    const runJob = vi.fn()
    // First call: investigate → returns a patch
    runJob.mockResolvedValueOnce({
      status: 'done',
      changedFiles: [{ path: 'src/lib/utils.ts', content: 'attempt-1' }],
      agent: {
        structuredOutput: {
          status: 'ready_to_merge',
          fixed: true,
          findings: [
            {
              fingerprint: 'quality:dead-code:src/lib/utils.ts:unusedFn',
              status: 'ready_to_merge',
              changed_files: ['src/lib/utils.ts'],
            },
          ],
        },
        sessionId: 'session-1',
        usage: { input_tokens: 80, output_tokens: 16 },
      },
    })
    // Second call: validate → fails
    runJob.mockResolvedValueOnce({
      status: 'done',
      results: [
        {
          id: 'lint',
          exitCode: 1,
          stdout: '',
          stderr: 'lint error',
          timedOut: false,
        },
      ],
    })
    // Third call: resume investigate with same session id → returns a fix
    runJob.mockResolvedValueOnce({
      status: 'done',
      changedFiles: [{ path: 'src/lib/utils.ts', content: 'attempt-2-fixed' }],
      agent: {
        structuredOutput: {
          status: 'ready_to_merge',
          fixed: true,
          findings: [
            {
              fingerprint: 'quality:dead-code:src/lib/utils.ts:unusedFn',
              status: 'ready_to_merge',
              changed_files: ['src/lib/utils.ts'],
            },
          ],
        },
        sessionId: 'session-1',
        usage: { input_tokens: 90, output_tokens: 18 },
      },
    })
    // Fourth call: validate → passes
    runJob.mockResolvedValueOnce({
      status: 'done',
      results: [
        { id: 'lint', exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { id: 'tsc', exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { id: 'vitest', exitCode: 0, stdout: '', stderr: '', timedOut: false },
      ],
    })

    const deps = makeDeps({ runJob })
    const result = await runRepairAgent(makeInput(), deps)

    expect(result.agentOutcome).toBe('patched')

    // The resume call should pass the session ID
    const resumeCall = runJob.mock.calls[2]
    expect(resumeCall).toBeDefined()
    const resumeRequest = resumeCall![0] as Record<string, unknown>
    expect(resumeRequest.agent).toBeDefined()
    const agentOptions = resumeRequest.agent as Record<string, unknown>
    expect(agentOptions.resumeSessionId).toBe('session-1')
    expect(runJob.mock.calls[1]![0]).toMatchObject({
      inputFiles: [{ path: 'src/lib/utils.ts', content: 'attempt-1' }],
    })
    expect(resumeRequest).toMatchObject({
      inputFiles: [{ path: 'src/lib/utils.ts', content: 'attempt-1' }],
    })
    expect(runJob.mock.calls[3]![0]).toMatchObject({
      inputFiles: [{ path: 'src/lib/utils.ts', content: 'attempt-2-fixed' }],
    })
  })

  it('two failed validations end needs_human with the diagnosis and no changedFiles', async () => {
    const runJob = vi.fn()
    // Investigate
    runJob.mockResolvedValueOnce({
      status: 'done',
      changedFiles: [{ path: 'src/a.ts', content: 'v1' }],
      agent: {
        structuredOutput: {
          status: 'ready_to_merge',
          fixed: true,
          findings: [],
        },
        sessionId: 's1',
        usage: { input_tokens: 70, output_tokens: 14 },
      },
    })
    // Validate 1 — fails
    runJob.mockResolvedValueOnce({
      status: 'done',
      results: [
        { id: 'lint', exitCode: 1, stdout: '', stderr: 'err', timedOut: false },
      ],
    })
    // Resume investigate
    runJob.mockResolvedValueOnce({
      status: 'done',
      changedFiles: [{ path: 'src/a.ts', content: 'v2' }],
      agent: {
        structuredOutput: {
          status: 'retry_required',
          fixed: false,
          findings: [],
        },
        sessionId: 's1',
        usage: { input_tokens: 72, output_tokens: 15 },
      },
    })
    // Validate 2 — fails
    runJob.mockResolvedValueOnce({
      status: 'done',
      results: [
        {
          id: 'tsc',
          exitCode: 1,
          stdout: '',
          stderr: 'type err',
          timedOut: false,
        },
      ],
    })

    const deps = makeDeps({ runJob })
    const result = await runRepairAgent(makeInput(), deps)

    expect(result.agentOutcome).toBe('needs_human')
    expect(result.changedFiles).toBeUndefined()
    expect(result.diagnosis).toBeDefined()
  })

  it('a noise verdict ends noise with its reason and no validation job', async () => {
    const runJob = vi.fn()
    // Investigate → returns noise verdict
    runJob.mockResolvedValueOnce({
      status: 'done',
      changedFiles: [],
      agent: {
        structuredOutput: {
          status: 'needs_human',
          fixed: false,
          findings: [
            {
              fingerprint: 'quality:dead-code:src/lib/utils.ts:unusedFn',
              status: 'needs_human',
              summary:
                'Known false positive — function is used via dynamic import',
            },
          ],
        },
        sessionId: 's-noise',
        usage: { input_tokens: 60, output_tokens: 12 },
      },
    })

    const deps = makeDeps({ runJob })
    const result = await runRepairAgent(makeInput(), deps)

    expect(result.agentOutcome).toBe('noise')
    expect(result.noiseReason).toBeDefined()
    // No validation should have run — only the investigate call
    expect(runJob).toHaveBeenCalledTimes(1)
  })

  it('recursion limit and an aborted signal end fallback, never a throw', async () => {
    // Create a pre-aborted signal
    const controller = new AbortController()
    controller.abort()

    const deps = makeDeps()
    const result = await runRepairAgent(makeInput(), deps, {
      signal: controller.signal,
    })

    expect(result.agentOutcome).toBe('fallback')
    // Must not throw
  })

  it('a Codex auth error ends fallback and carries credential:codex', async () => {
    const runJob = vi.fn().mockResolvedValue({
      status: 'error',
      error: '401 Unauthorized: invalid Codex token',
    })

    const deps = makeDeps({ runJob })
    const result = await runRepairAgent(makeInput(), deps)

    expect(result.agentOutcome).toBe('fallback')
    expect(result.error).toContain('credential:codex')
  })

  it('a repo-worker validation failure cannot be reported as a passing patch', async () => {
    const runJob = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'done',
        changedFiles: [{ path: 'src/a.ts', content: 'fixed' }],
        agent: {
          structuredOutput: { status: 'ready_to_merge', findings: [] },
          sessionId: 'session-1',
        },
      })
      .mockResolvedValueOnce({
        status: 'error',
        error: 'repo worker unavailable',
      })

    const result = await runRepairAgent(makeInput(), makeDeps({ runJob }))

    expect(result).toMatchObject({
      agentOutcome: 'fallback',
      error: 'repo worker unavailable',
    })
  })

  it('the investigator prompt is fetched from Langfuse by name and its name and version are recorded', async () => {
    promptCalls.length = 0

    const fetchPrompt = vi.fn().mockResolvedValue({
      text: 'Investigator prompt text',
      prompt: {
        name: 'health-investigator',
        version: 3,
        source: 'langfuse' as const,
      },
    })

    const deps = makeDeps({ fetchPrompt })
    const result = await runRepairAgent(makeInput(), deps)

    // fetchPrompt was called with the prompt name
    expect(fetchPrompt).toHaveBeenCalledWith(
      'health-investigator',
      expect.any(Object),
    )

    // The result records prompt metadata
    expect(result.promptMeta).toBeDefined()
    expect(result.promptMeta!.name).toBe('health-investigator')
    expect(result.promptMeta!.version).toBe(3)
  })
})
