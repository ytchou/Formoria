import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The repair path runs the REAL `auditedCall` envelope from the shared runtime.
 * Mocking internal service modules is refused by the test-boundaries guard,
 * so the audit write is captured through the seam and `persistAuditEvent` /
 * `emitLangfuseGeneration` are injected through the audit context's test hooks.
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

function makeAudit(persist = vi.fn().mockResolvedValue(undefined)) {
  return {
    audit: {
      jobId: 'job-1',
      target: { type: 'brand' as const, id: 'brand-1' },
      modelName: 'gpt-test',
      _persistAuditEvent: persist,
      _emitLangfuseGeneration: vi.fn(),
    },
    persist,
  }
}

function fakeModel(responses: string[]) {
  const fake = new FakeListChatModel({ responses })
  const invoke = vi.spyOn(fake, 'invoke')
  return { model: fake as unknown as AgentModel, invoke }
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

  it('repair_calls_model_once_with_profile_editorial_and_phase_descriptions', async () => {
    const { audit, persist } = makeAudit()
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
      audit,
    })

    expect(EDITORIAL_REPAIR_PROFILE).toBe('editorial')
    expect(EDITORIAL_REPAIR_AUDIT_PHASE).toBe('descriptions')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0][0]).toMatchObject({ phase: 'descriptions', jobId: 'job-1' })
    expect(repaired).toEqual({ description_en: CLEAN_EN })
  })

  it('repair_keeps_original_when_model_output_still_fails', async () => {
    const { audit } = makeAudit()
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
      audit,
    })

    expect(repaired).toEqual({})
  })

  it('repair_never_touches_stockists_or_faq_fields', async () => {
    const { audit } = makeAudit()
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
      audit,
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
    const { audit, persist } = makeAudit()
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
      audit,
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

    expect(createModel).toHaveBeenCalledWith('editorial')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0][0]).toMatchObject({ phase: 'descriptions' })
    expect(repaired).toEqual({ description_en: CLEAN_EN })
    expect(typeof deps.requestEvidence).toBe('function')
  })
})
