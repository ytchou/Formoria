import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { setAuditWriteSeam } from '@/lib/audit/emit'
import type { PhaseResult } from '@/lib/types/curation'

// ---------------------------------------------------------------------------
// Mocks — only non-service modules (test-boundaries forbids @/lib/services/)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  fetchLangfusePrompt: vi
    .fn()
    .mockImplementation((_name: string, fallback: string) => Promise.resolve(fallback)),
  fetchLangfusePromptWithMeta: vi
    .fn()
    .mockImplementation((_name: string, fallback: string) => Promise.resolve({ text: fallback, prompt: { name: _name, version: 1 } })),
}))

vi.mock('@/lib/langfuse/prompt', () => ({
  fetchLangfusePrompt: mocks.fetchLangfusePrompt,
  fetchLangfusePromptWithMeta: mocks.fetchLangfusePromptWithMeta,
}))

import {
  buildEditorialDeps,
  createRequestEvidence,
  repairEditorialCrossOutput,
  validateEditorialCrossOutput,
  EDITORIAL_REPAIR_AUDIT_PHASE,
  EDITORIAL_REPAIR_PROFILE,
} from '../validators'
import type { AgentModel } from '../../agents/runtime'
import type { ChatMessage, ChatToolDefinition } from '@/lib/services/openai-client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The audit row for a repair turn is written by the audited client inside
 * `createAgentModel` (DEV-1700), not by anything in this module — these tests
 * inject a plain `{ invoke }` fake and assert what the repair sends and keeps.
 * The seam is still installed so nothing reaches a real emitter.
 */
function captureAuditWrites(): void {
  setAuditWriteSeam(async () => null)
}

function succeeded(phase: string): PhaseResult {
  return { phase, status: 'succeeded', changedFields: [], durationMs: 1 }
}

/** English prose with an AI-slop opener that `detectAiArtifacts` flags. */
const ARTIFACT_EN = 'In a world where design matters, this studio keeps making the same quiet bowls.'

/** Clean English prose: no slop pattern, high Latin purity. */
const CLEAN_EN = 'A small Taipei studio making everyday ceramics for narrow kitchens.'

const AUDIT = {
  jobId: 'job-1',
  target: { type: 'brand' as const, id: '00000000-0000-4000-8000-000000000001' },
}

function fakeModel(responses: string[]) {
  let index = 0
  const invoke = vi.fn(
    async (
      _messages: ChatMessage[],
      _options?: { signal?: AbortSignal; tools?: ChatToolDefinition[] },
    ) => ({ content: responses[Math.min(index++, responses.length - 1)] ?? null }),
  )
  return { model: { invoke } as AgentModel, invoke }
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

describe('editorial cross-output validators', () => {
  beforeEach(() => {
    captureAuditWrites()
    mocks.fetchLangfusePrompt.mockImplementation(
      (_name: string, fallback: string) => Promise.resolve(fallback),
    )
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    setAuditWriteSeam(null)
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('validate_flags_ai_artifacts_and_bad_city', () => {
    const failures = validateEditorialCrossOutput(
      {
        description_en: ARTIFACT_EN,
        // English prose in the zh column fails the language-purity check.
        description: 'This English sentence is sitting in the Chinese description column.',
        city: 'kyoto',
      },
      [succeeded('descriptions'), succeeded('stockists'), succeeded('faq')],
      { brandName: 'Test Brand' },
    )

    expect(
      failures.some((f) => f.field === 'description_en' && f.reason.startsWith('ai_artifact:')),
    ).toBe(true)
    expect(
      failures.some((f) => f.field === 'description' && f.reason === 'language_purity'),
    ).toBe(true)
    expect(failures.some((f) => f.field === 'city')).toBe(true)
  })

  it('validate_passes_clean_patch_and_known_city', () => {
    const failures = validateEditorialCrossOutput(
      { description_en: CLEAN_EN, city: 'taipei' },
      [succeeded('descriptions')],
      { brandName: 'Test Brand' },
    )

    expect(failures).toEqual([])
  })

  it('validate_skips_fields_whose_phase_failed', () => {
    const failures = validateEditorialCrossOutput(
      { description_en: ARTIFACT_EN, city: 'kyoto' },
      [{ phase: 'descriptions', status: 'failed', changedFields: [], durationMs: 1 }],
      {},
    )

    expect(failures).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Repair
  // -------------------------------------------------------------------------

  it('repair_sends_system_and_user_as_plain_messages', async () => {
    const controller = new AbortController()
    const { model, invoke } = fakeModel([
      JSON.stringify({
        description: null,
        description_en: CLEAN_EN,
        blurb: null,
        blurb_en: null,
      }),
    ])

    const repaired = await repairEditorialCrossOutput({
      patch: { description_en: ARTIFACT_EN, city: 'taipei' },
      failures: [{ field: 'description_en', reason: 'ai_artifact:^in a world where\\b' }],
      evidence: 'Founded in 2014 by two designers.',
      model,
      signal: controller.signal,
    })

    expect(EDITORIAL_REPAIR_PROFILE).toBe('editorial')
    expect(EDITORIAL_REPAIR_AUDIT_PHASE).toBe('descriptions')
    expect(invoke).toHaveBeenCalledTimes(1)

    // Plain OpenAI wire messages, not framework message objects.
    const [messages, options] = invoke.mock.calls[0]!
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('system')
    expect(messages[0]!.content).toContain('EditorialRepair JSON Schema')
    expect(messages[1]!.role).toBe('user')
    expect(JSON.parse(messages[1]!.content as string)).toMatchObject({
      fieldsToFix: ['description_en'],
      evidence: 'Founded in 2014 by two designers.',
    })
    expect(options).toEqual({ signal: controller.signal })

    expect(repaired).toEqual({ description_en: CLEAN_EN })
  })

  it('repair_failure_returns_empty_patch', async () => {
    const model = {
      invoke: vi.fn().mockRejectedValue(new Error('openai 500: server exploded')),
    } as unknown as AgentModel

    const deps = buildEditorialDeps({
      runDescriptions: vi.fn(),
      runStockists: vi.fn(),
      runFaq: vi.fn(),
      audit: AUDIT,
      brandName: 'Test Brand',
      model,
      requestEvidence: vi.fn().mockResolvedValue(''),
    })

    const repaired = await deps.repairCrossOutput({ description_en: ARTIFACT_EN }, [
      { field: 'description_en', reason: 'ai_artifact:^in a world where\\b' },
    ])

    expect(repaired).toEqual({})
  })

  it('repair_keeps_original_when_model_output_still_fails', async () => {
    const { model } = fakeModel([
      JSON.stringify({
        description: null,
        description_en: 'In a world where nothing was fixed at all.',
        blurb: null,
        blurb_en: null,
      }),
    ])

    const repaired = await repairEditorialCrossOutput({
      patch: { description_en: ARTIFACT_EN },
      failures: [{ field: 'description_en', reason: 'ai_artifact:^in a world where\\b' }],
      model,
    })

    expect(repaired).toEqual({})
  })

  it('repair_never_touches_stockists_or_faq_fields', async () => {
    const { model } = fakeModel([
      JSON.stringify({
        description: null,
        description_en: CLEAN_EN,
        blurb: null,
        blurb_en: null,
      }),
    ])

    const repaired = await repairEditorialCrossOutput({
      patch: { description_en: ARTIFACT_EN, city: 'taipei' },
      failures: [
        { field: 'description_en', reason: 'ai_artifact:^in a world where\\b' },
        { field: 'faq_entries[0]', reason: 'faq_preset_not_eligible' },
      ],
      model,
    })

    expect(Object.keys(repaired)).toEqual(['description_en'])
  })

  // -------------------------------------------------------------------------
  // Evidence tool
  // -------------------------------------------------------------------------

  it('request_evidence_returns_bounded_chunk_or_empty', async () => {
    const needle = 'founded in 2014 by two designers'
    const loadStructure = vi.fn().mockResolvedValue({
      'https://example.com/about': {
        title: 'About',
        description: `${'x'.repeat(3000)} ${needle} ${'y'.repeat(3000)}`,
        story: null,
      },
    })

    const requestEvidence = createRequestEvidence({ brandId: 'brand-1', loadStructure })

    const hit = await requestEvidence('https://example.com/about', 'Founded In 2014')
    expect(hit).toContain(needle)
    expect(hit.length).toBeLessThanOrEqual(1500)

    const miss = await requestEvidence('https://example.com/about', 'no such phrase here')
    expect(miss).toBe('')

    const unknownPage = await requestEvidence('https://other.example/', needle)
    expect(unknownPage).toBe('')

    // One load for the whole run: the persisted pack is fetched once and cached.
    expect(loadStructure).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------------
  // Dep wiring
  // -------------------------------------------------------------------------

  it('buildEditorialDeps_wires_real_validators', async () => {
    const { model, invoke } = fakeModel([
      JSON.stringify({
        description: null,
        description_en: CLEAN_EN,
        blurb: null,
        blurb_en: null,
      }),
    ])
    const createModel = vi.fn().mockResolvedValue(model)

    const deps = buildEditorialDeps({
      runDescriptions: vi.fn(),
      runStockists: vi.fn(),
      runFaq: vi.fn(),
      audit: AUDIT,
      brandName: 'Test Brand',
      createModel,
      requestEvidence: vi.fn().mockResolvedValue('Founded in 2014.'),
    })

    // The real validator, not a stub that returns [].
    const failures = deps.validateCrossOutput(
      { description_en: ARTIFACT_EN, city: 'kyoto' },
      [succeeded('descriptions')],
    )
    expect(failures.length).toBeGreaterThan(0)
    expect(failures.some((f) => f.field === 'city')).toBe(true)

    // The real repair, not a stub that echoes the patch back.
    const repaired = await deps.repairCrossOutput({ description_en: ARTIFACT_EN }, [
      { field: 'description_en', reason: 'ai_artifact:^in a world where\\b' },
    ])

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(repaired).toEqual({ description_en: CLEAN_EN })
    expect(typeof deps.requestEvidence).toBe('function')
  })

  it('buildEditorialDeps_creates_the_model_with_the_descriptions_phase', async () => {
    const { model } = fakeModel([
      JSON.stringify({
        description: null,
        description_en: CLEAN_EN,
        blurb: null,
        blurb_en: null,
      }),
    ])
    const createModel = vi.fn().mockResolvedValue(model)

    const deps = buildEditorialDeps({
      runDescriptions: vi.fn(),
      runStockists: vi.fn(),
      runFaq: vi.fn(),
      audit: AUDIT,
      brandName: 'Test Brand',
      createModel,
      requestEvidence: vi.fn().mockResolvedValue(''),
    })

    await deps.repairCrossOutput({ description_en: ARTIFACT_EN }, [
      { field: 'description_en', reason: 'ai_artifact:^in a world where\\b' },
    ])

    // The audit context is bound at construction — the row's phase can no longer
    // drift from the turn that wrote it.
    expect(createModel).toHaveBeenCalledWith(EDITORIAL_REPAIR_PROFILE, {
      ...AUDIT,
      phase: EDITORIAL_REPAIR_AUDIT_PHASE,
    })
  })
})
