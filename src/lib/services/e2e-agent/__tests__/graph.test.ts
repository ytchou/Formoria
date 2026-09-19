/**
 * E2E self-heal graph tests.
 *
 * All behavior is controlled via DI deps — no vi.mock on @/lib/services/.
 * The freeze node runs real logic (pure function from incident.ts); the
 * diagnose/repair/validate/report nodes are controlled via mock deps.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CompiledStateGraph } from '@langchain/langgraph'

import {
  buildSelfHealGraph,
  runSelfHealGraph,
  RECURSION_LIMIT,
  type E2eSelfHealDeps,
  type SelfHealInput,
} from '../graph'

// Stub Langfuse env to prevent real connections
beforeAll(() => {
  vi.stubEnv('LANGFUSE_PUBLIC_KEY', '')
  vi.stubEnv('LANGFUSE_SECRET_KEY', '')
  vi.stubEnv('LANGFUSE_HOST', '')
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<SelfHealInput> = {}): SelfHealInput {
  return {
    runResult: {
      failures: [
        {
          file: 'e2e/brands.spec.ts',
          title: 'brand page loads',
          project: 'deep',
          error: 'Element not found',
        },
      ],
    },
    runId: 'test-run-001',
    stagingSha: 'abc123def456',
    ...overrides,
  }
}

/** Build a mock RepoWorkerClient whose `.run()` resolves to `result`. */
function mockClient(result: Record<string, unknown>) {
  return { run: vi.fn().mockResolvedValue(result) }
}

/** DiagnosisResult structured output: all env-flake → noise aggregate. */
function noiseDiagnosisOutput() {
  return {
    version: 1,
    failureSetHash: 'mock-hash',
    failures: [
      {
        id: 'f1',
        file: 'e2e/brands.spec.ts',
        title: 'brand page loads',
        project: 'deep',
        category: 'env-flake',
        rootCauseKey: 'rk1',
        actionable: false,
        reason: 'Transient network flake',
      },
    ],
    clusters: [
      {
        rootCauseKey: 'rk1',
        failureIds: ['f1'],
        category: 'env-flake',
        actionable: false,
        plannedFiles: [],
        diagnosis: 'Network timeout during page load',
        repairPlan: 'No action needed',
      },
    ],
    complete: true,
  }
}

/** DiagnosisResult structured output: test-drift → actionable aggregate. */
function actionableDiagnosisOutput() {
  return {
    version: 1,
    failureSetHash: 'mock-hash',
    failures: [
      {
        id: 'f1',
        file: 'e2e/brands.spec.ts',
        title: 'brand page loads',
        project: 'deep',
        category: 'test-drift',
        rootCauseKey: 'rk1',
        actionable: true,
        reason: 'CSS selector changed',
      },
    ],
    clusters: [
      {
        rootCauseKey: 'rk1',
        failureIds: ['f1'],
        category: 'test-drift',
        actionable: true,
        plannedFiles: ['e2e/brands.spec.ts'],
        diagnosis: 'Brand card CSS class renamed',
        repairPlan: 'Update selector in spec file',
      },
    ],
    complete: true,
  }
}

/** Default deps: actionable diagnosis → repair with changes → passing validation. */
function makeDeps(
  overrides: Partial<E2eSelfHealDeps> = {},
): E2eSelfHealDeps {
  const diagnoseClient = mockClient({
    status: 'done',
    claude: { structuredOutput: actionableDiagnosisOutput() },
  })
  const repairClient = mockClient({
    status: 'done',
    changedFiles: [
      { path: 'e2e/brands.spec.ts', content: 'updated selector' },
    ],
    baseSha: 'abc123def456',
  })

  return {
    createClient: vi
      .fn()
      .mockReturnValueOnce(diagnoseClient)
      .mockReturnValueOnce(repairClient),
    fetchPrompt: vi.fn().mockResolvedValue('Test prompt'),
    publish: vi
      .fn()
      .mockResolvedValue({ ok: true, prUrl: 'https://github.com/test/pr/1' }),
    createTicket: vi
      .fn()
      .mockResolvedValue({
        identifier: 'DEV-9999',
        url: 'https://linear.app/test',
      }),
    postSlackMessage: vi.fn().mockResolvedValue({ ok: true }),
    cloneAndRunTests: vi
      .fn()
      .mockResolvedValue({ passed: true, output: 'All tests passed' }),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('e2e self-heal graph', () => {
  it('graph_transitions_freeze_to_diagnose', () => {
    expect(RECURSION_LIMIT).toBeGreaterThanOrEqual(8)

    const graph = buildSelfHealGraph(makeDeps())
    expect(graph).toBeInstanceOf(CompiledStateGraph)

    const drawn = graph.getGraph()
    const nodeNames = Object.keys(drawn.nodes)
    expect(nodeNames).toEqual(
      expect.arrayContaining([
        'freeze',
        'diagnose',
        'repair',
        'validate',
        'report',
      ]),
    )

    // freeze → diagnose edge exists
    const freezeEdges = drawn.edges.filter((e) => e.source === 'freeze')
    expect(freezeEdges.some((e) => e.target === 'diagnose')).toBe(true)
  })

  it('graph_skips_repair_on_noise_diagnosis', async () => {
    const noiseClient = mockClient({
      status: 'done',
      claude: { structuredOutput: noiseDiagnosisOutput() },
    })

    const deps = makeDeps({
      createClient: vi.fn().mockReturnValue(noiseClient),
    })

    const result = await runSelfHealGraph(makeInput(), deps)
    expect(result.outcome).toBe('noise')

    // Repair/validate should not have been called
    expect(deps.cloneAndRunTests).not.toHaveBeenCalled()
  })

  it('graph_cycles_diagnose_repair_validate_up_to_max', async () => {
    const createClient = vi.fn()
    // Cycle 1: diagnose
    createClient.mockReturnValueOnce(
      mockClient({
        status: 'done',
        claude: { structuredOutput: actionableDiagnosisOutput() },
      }),
    )
    // Cycle 1: repair
    createClient.mockReturnValueOnce(
      mockClient({
        status: 'done',
        changedFiles: [{ path: 'e2e/brands.spec.ts', content: 'attempt-1' }],
        baseSha: 'abc123def456',
      }),
    )
    // Cycle 2: diagnose (after failed validate)
    createClient.mockReturnValueOnce(
      mockClient({
        status: 'done',
        claude: { structuredOutput: actionableDiagnosisOutput() },
      }),
    )
    // Cycle 2: repair
    createClient.mockReturnValueOnce(
      mockClient({
        status: 'done',
        changedFiles: [{ path: 'e2e/brands.spec.ts', content: 'attempt-2' }],
        baseSha: 'abc123def456',
      }),
    )

    const cloneAndRunTests = vi
      .fn()
      .mockResolvedValue({ passed: false, output: 'Still failing' })

    const deps = makeDeps({ createClient, cloneAndRunTests })
    const result = await runSelfHealGraph(makeInput(), deps)

    // 2 validate calls (both fail)
    expect(cloneAndRunTests).toHaveBeenCalledTimes(2)
    // 4 createClient calls (diagnose + repair × 2 cycles)
    expect(createClient).toHaveBeenCalledTimes(4)
    expect(result.outcome).toBe('needs_human')
    expect(result.cycle).toBe(2)
  })

  it('graph_reports_patched_when_validation_passes', async () => {
    const deps = makeDeps()
    const result = await runSelfHealGraph(makeInput(), deps)

    expect(result.outcome).toBe('patched')
    expect(result.cycle).toBe(1)
    expect(deps.cloneAndRunTests).toHaveBeenCalledTimes(1)
  })

  it('graph_reports_needs_human_when_cycles_exhausted', async () => {
    const createClient = vi.fn()
    // Cycle 1
    createClient.mockReturnValueOnce(
      mockClient({
        status: 'done',
        claude: { structuredOutput: actionableDiagnosisOutput() },
      }),
    )
    createClient.mockReturnValueOnce(
      mockClient({
        status: 'done',
        changedFiles: [{ path: 'e2e/brands.spec.ts', content: 'v1' }],
        baseSha: 'abc123def456',
      }),
    )
    // Cycle 2
    createClient.mockReturnValueOnce(
      mockClient({
        status: 'done',
        claude: { structuredOutput: actionableDiagnosisOutput() },
      }),
    )
    createClient.mockReturnValueOnce(
      mockClient({
        status: 'done',
        changedFiles: [{ path: 'e2e/brands.spec.ts', content: 'v2' }],
        baseSha: 'abc123def456',
      }),
    )

    const deps = makeDeps({
      createClient,
      cloneAndRunTests: vi
        .fn()
        .mockResolvedValue({ passed: false, output: 'Failing' }),
    })

    const result = await runSelfHealGraph(makeInput(), deps)
    expect(result.outcome).toBe('needs_human')
  })

  it('graph_reports_needs_human_when_no_changes_produced', async () => {
    const createClient = vi.fn()
    // Diagnose: actionable
    createClient.mockReturnValueOnce(
      mockClient({
        status: 'done',
        claude: { structuredOutput: actionableDiagnosisOutput() },
      }),
    )
    // Repair: no changed files
    createClient.mockReturnValueOnce(
      mockClient({
        status: 'done',
        changedFiles: [],
        baseSha: 'abc123def456',
      }),
    )

    const deps = makeDeps({ createClient })
    const result = await runSelfHealGraph(makeInput(), deps)

    expect(result.outcome).toBe('needs_human')
    // Validate should not run — repair produced no changes
    expect(deps.cloneAndRunTests).not.toHaveBeenCalled()
  })
})
