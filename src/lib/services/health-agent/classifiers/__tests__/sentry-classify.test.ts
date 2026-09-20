import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SentryIssue } from '@/lib/adapters/sentry/issues'
import {
  classifySentryIssue,
  type SentryClassifyDeps,
} from '../sentry-classify'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function issue(overrides: Partial<SentryIssue> = {}): SentryIssue {
  return {
    id: '123456',
    title: 'TypeError: Cannot read cart total',
    count: '7',
    userCount: 3,
    lastSeen: '2026-09-19T04:05:06.000Z',
    permalink: 'https://sentry.io/organizations/formoria/issues/123456/',
    level: 'error',
    culprit: 'app/api/cart/route',
    firstSeen: '2026-09-18T01:00:00.000Z',
    platform: 'node',
    metadata: { type: 'TypeError', value: 'Cannot read cart total' },
    ...overrides,
  }
}

const VALID_CLASSIFICATION = {
  severity: 'medium' as const,
  rootCause: 'Null reference in cart handler',
  confidence: 0.9,
  fixability: 'high' as const,
  mergePolicy: 'automatic' as const,
  changedFiles: ['src/app/api/cart/route.ts'],
}

const PROMPT_META = {
  name: 'sentry-classify',
  version: 1,
  source: 'snapshot' as const,
}

function chatOk(data: unknown) {
  return {
    response: { ok: true },
    data: {},
    content: JSON.stringify(data),
    ok: true,
    status: 200,
    errorBody: null,
    finishReason: 'stop',
    refusal: null,
    toolCalls: null,
  }
}

function makeDeps(mockChat: ReturnType<typeof vi.fn>): SentryClassifyDeps {
  const fetchPrompt = vi.fn(async (_name: string, vars?: Record<string, string>) => ({
    text: 'Classify the following Sentry issue.',
    prompt: PROMPT_META,
    _vars: vars,
  }))
  return {
    createClient: vi.fn(() => ({ chat: mockChat })) as unknown as SentryClassifyDeps['createClient'],
    chatParams: vi.fn(() => ({
      maxTokens: 800,
      temperature: 0,
      timeoutMs: 30_000,
    })) as unknown as SentryClassifyDeps['chatParams'],
    fetchPrompt: fetchPrompt as unknown as SentryClassifyDeps['fetchPrompt'],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'test-key')
})

describe('classifySentryIssue', () => {
  it('classifySentryIssue_returns_classification_for_valid_llm_response', async () => {
    const mockChat = vi.fn().mockResolvedValueOnce(chatOk(VALID_CLASSIFICATION))
    const deps = makeDeps(mockChat)

    const result = await classifySentryIssue(issue(), deps)

    expect(result).toEqual(VALID_CLASSIFICATION)
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('classifySentryIssue_returns_null_after_two_schema_failures', async () => {
    const bad = { severity: 'invalid' }
    const mockChat = vi.fn()
      .mockResolvedValueOnce(chatOk(bad))
      .mockResolvedValueOnce(chatOk(bad))
    const deps = makeDeps(mockChat)

    const result = await classifySentryIssue(issue(), deps)

    expect(result).toBeNull()
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  it('classifySentryIssue_returns_null_when_llm_throws', async () => {
    const mockChat = vi.fn().mockRejectedValueOnce(new Error('API down'))
    const deps = makeDeps(mockChat)

    const result = await classifySentryIssue(issue(), deps)

    expect(result).toBeNull()
  })

  it('classifySentryIssue_sanitizes_long_culprit', async () => {
    const mockChat = vi.fn().mockResolvedValueOnce(chatOk(VALID_CLASSIFICATION))
    const deps = makeDeps(mockChat)
    const longCulprit = 'a'.repeat(500)

    await classifySentryIssue(issue({ culprit: longCulprit }), deps)

    const fetchCalls = vi.mocked(deps.fetchPrompt).mock.calls
    const lastCall = fetchCalls[fetchCalls.length - 1]
    const issueVar = (lastCall[1] as Record<string, string>)?.issue
    expect(issueVar).toBeDefined()
    const parsed = JSON.parse(issueVar)
    expect(parsed.culprit.length).toBeLessThanOrEqual(200)
  })

  it('classifySentryIssue_strips_secrets_from_issue_text', async () => {
    const mockChat = vi.fn().mockResolvedValueOnce(chatOk(VALID_CLASSIFICATION))
    const deps = makeDeps(mockChat)

    const secretTitle =
      'Error: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.abc123 failed'
    const secretCulprit = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz handler'

    await classifySentryIssue(
      issue({ title: secretTitle, culprit: secretCulprit }),
      deps,
    )

    const fetchCalls = vi.mocked(deps.fetchPrompt).mock.calls
    const lastCall = fetchCalls[fetchCalls.length - 1]
    const issueVar = (lastCall[1] as Record<string, string>)?.issue
    expect(issueVar).toBeDefined()
    expect(issueVar).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(issueVar).not.toContain('ghp_1234567890abcdefghijklmnopqrstuvwxyz')
    expect(issueVar).toContain('[REDACTED]')
  })
})
