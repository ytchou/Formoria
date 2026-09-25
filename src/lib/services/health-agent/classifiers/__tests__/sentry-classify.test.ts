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

function userPayload(mockChat: ReturnType<typeof vi.fn>): string {
  const user = mockChat.mock.calls[0]![0].user as string
  return user.slice('Classify this Sentry issue:\n'.length)
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

  it('classifySentryIssue_returns_null_on_schema_failure_without_retry', async () => {
    const bad = { severity: 'invalid' }
    const mockChat = vi.fn().mockResolvedValue(chatOk(bad))
    const deps = makeDeps(mockChat)

    const result = await classifySentryIssue(issue(), deps)

    expect(result).toBeNull()
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('classifySentryIssue_returns_null_on_unparseable_content_without_retry', async () => {
    const mockChat = vi.fn().mockResolvedValue({ ...chatOk({}), content: '{bad' })
    const deps = makeDeps(mockChat)

    const result = await classifySentryIssue(issue(), deps)

    expect(result).toBeNull()
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('classifySentryIssue_sends_strict_json_schema_not_json_mode', async () => {
    const mockChat = vi.fn().mockResolvedValueOnce(chatOk(VALID_CLASSIFICATION))
    const deps = makeDeps(mockChat)

    await classifySentryIssue(issue(), deps)

    const input = mockChat.mock.calls[0]![0]
    expect(input.json).toBeUndefined()
    expect(input.schema.name).toBe('sentry_classification')
    expect(input.schema.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    })
    expect(input.schema.schema.$schema).toBeUndefined()
  })

  it('classifySentryIssue_puts_issue_json_in_user_message_not_system_prompt', async () => {
    const mockChat = vi.fn().mockResolvedValueOnce(chatOk(VALID_CLASSIFICATION))
    const deps = makeDeps(mockChat)

    await classifySentryIssue(issue(), deps)

    const input = mockChat.mock.calls[0]![0]
    expect(input.user.startsWith('Classify this Sentry issue:\n')).toBe(true)
    const payload = JSON.parse(input.user.slice('Classify this Sentry issue:\n'.length))
    expect(payload.id).toBe('123456')
    expect(input.system).not.toContain('123456')
    const vars = vi.mocked(deps.fetchPrompt).mock.calls[0]![1] as Record<string, string>
    expect(vars.issue).not.toContain('123456')
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

    const issueVar = userPayload(mockChat)
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

    const issueVar = userPayload(mockChat)
    expect(issueVar).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(issueVar).not.toContain('ghp_1234567890abcdefghijklmnopqrstuvwxyz')
    expect(issueVar).toContain('[REDACTED]')
  })
})
