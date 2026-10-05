import { describe, expect, it, vi } from 'vitest'

import type { LoggedRequest } from '../../llm-audit'
import {
  normalizeFresh,
  normalizeStored,
  rebuildImages,
  toChatInput,
  type ImageRebuildDeps,
  type ImageSpan,
} from '../request-replay-request'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BRAND_TARGET = { type: 'brand' as const, id: '7d1e2f40-1c2b-4a5e-9f10-3a4b5c6d7e8f' }
const SUBMISSION_TARGET = { type: 'submission' as const, id: '2f9a8b7c-6d5e-4f3a-8b2c-1d0e9f8a7b6c' }
const IMAGE_A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const IMAGE_B = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e'
const OMITTED = { omitted: 'data-uri' }

function logged(fields: Record<string, unknown>): LoggedRequest {
  return { v: 1, ...fields } as LoggedRequest
}

function deps(overrides: Partial<ImageRebuildDeps> = {}): ImageRebuildDeps {
  return {
    loadStoredImage: vi.fn(async () => null),
    loadBySourceUrl: vi.fn(async () => null),
    fetchVisionImage: vi.fn(async () => null),
    ...overrides,
  }
}

function span(request: LoggedRequest, target: ImageSpan['target'] = BRAND_TARGET): ImageSpan {
  return { request, target }
}

// ---------------------------------------------------------------------------
// toChatInput
// ---------------------------------------------------------------------------

describe('toChatInput', () => {
  it('passes single-call fields through and drops v', () => {
    const schema = { name: 'verdict', schema: { type: 'object' } }
    const input = toChatInput(
      logged({
        system: 'sys',
        user: 'usr',
        json: true,
        schema,
        maxTokens: 700,
        temperature: 0,
        reasoningEffort: 'none',
        timeoutMs: 120_000,
        imageDetail: 'low',
      }),
    )
    expect(input).toEqual({
      system: 'sys',
      user: 'usr',
      json: true,
      schema,
      maxTokens: 700,
      temperature: 0,
      reasoningEffort: 'none',
      timeoutMs: 120_000,
      imageDetail: 'low',
    })
    expect(input).not.toHaveProperty('v')
  })

  it('keeps messages and tools in caller form and never adds a schema next to tools', () => {
    const messages = [
      { role: 'system', content: 'plan' },
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }],
      },
      { role: 'tool', content: '[]', tool_call_id: 'c1' },
    ]
    const tools = [{ name: 'submit_plan', description: 'd', parameters: { type: 'object' } }]
    const input = toChatInput(
      logged({ messages, tools, json: true, schema: { name: 's', schema: {} }, maxTokens: 900 }),
    )
    expect(input.messages).toEqual(messages)
    expect(input.tools).toEqual(tools)
    expect(input).not.toHaveProperty('schema')
    expect(input).not.toHaveProperty('json')
    expect(input.maxTokens).toBe(900)
  })

  it('replaces logged images with the rebuilt ones', () => {
    const input = toChatInput(logged({ user: 'u', images: [OMITTED] }), ['data:image/jpeg;base64,AAA'])
    expect(input.images).toEqual(['data:image/jpeg;base64,AAA'])
  })
})

// ---------------------------------------------------------------------------
// rebuildImages: stored path
// ---------------------------------------------------------------------------

describe('rebuildImages on the stored path', () => {
  it('resolves UUID imageIds through loadStoredImage in order', async () => {
    const loadStoredImage = vi.fn(async (_table: string, id: string) => `data:${id}`)
    const result = await rebuildImages(
      span(logged({ user: 'u', images: [OMITTED, OMITTED], meta: { imageIds: [IMAGE_A, IMAGE_B] } })),
      deps({ loadStoredImage }),
    )
    expect(result).toEqual({ images: [`data:${IMAGE_A}`, `data:${IMAGE_B}`] })
    expect(loadStoredImage.mock.calls).toEqual([
      ['brand_images', IMAGE_A],
      ['brand_images', IMAGE_B],
    ])
  })

  it('reads submission_images when the target is a submission', async () => {
    const loadStoredImage = vi.fn(async () => 'data:x')
    await rebuildImages(
      span(logged({ user: 'u', images: [OMITTED], meta: { imageIds: [IMAGE_A] } }), SUBMISSION_TARGET),
      deps({ loadStoredImage }),
    )
    expect(loadStoredImage).toHaveBeenCalledWith('submission_images', IMAGE_A)
  })

  it('skips the span when any stored image is missing', async () => {
    const loadStoredImage = vi.fn(async (_table: string, id: string) => (id === IMAGE_B ? null : 'data:x'))
    const result = await rebuildImages(
      span(logged({ user: 'u', images: [OMITTED, OMITTED], meta: { imageIds: [IMAGE_A, IMAGE_B] } })),
      deps({ loadStoredImage }),
    )
    expect(result).toEqual({ skip: 'image' })
  })

  it('loads once per span and reuses the cached result', async () => {
    const loadStoredImage = vi.fn(async () => 'data:x')
    const s = span(logged({ user: 'u', images: [OMITTED], meta: { imageIds: [IMAGE_A] } }))
    const first = await rebuildImages(s, deps({ loadStoredImage }))
    const second = await rebuildImages(s, deps({ loadStoredImage }))
    expect(second).toBe(first)
    expect(s.imageRebuild).toBe(first)
    expect(loadStoredImage).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// rebuildImages: acquire path
// ---------------------------------------------------------------------------

describe('rebuildImages on the acquire path', () => {
  const urlA = 'https://shop.example.tw/a.jpg'
  const urlB = 'https://shop.example.tw/b.jpg'

  it('resolves ordinal ids by source_url, falling back to a re-fetch', async () => {
    const loadBySourceUrl = vi.fn(async (_table: string, _targetId: string, url: string) =>
      url === urlA ? 'data:stored-a' : null,
    )
    const fetchVisionImage = vi.fn(async (url: string) => (url === urlB ? 'data:fetched-b' : null))
    const result = await rebuildImages(
      span(logged({ user: 'u', images: [urlA, { url: urlB }], meta: { imageIds: ['1', '2'] } })),
      deps({ loadBySourceUrl, fetchVisionImage }),
    )
    expect(result).toEqual({ images: ['data:stored-a', 'data:fetched-b'] })
    expect(loadBySourceUrl).toHaveBeenCalledWith('brand_images', BRAND_TARGET.id, urlA)
    expect(fetchVisionImage).toHaveBeenCalledTimes(1)
    expect(fetchVisionImage).toHaveBeenCalledWith(urlB)
  })

  it('skips when both the stored lookup and the re-fetch return null', async () => {
    const result = await rebuildImages(
      span(logged({ user: 'u', images: [urlA], meta: { imageIds: ['1'] } })),
      deps(),
    )
    expect(result).toEqual({ skip: 'image' })
  })

  it('skips an ordinal image that was logged as omitted', async () => {
    const result = await rebuildImages(
      span(logged({ user: 'u', images: [OMITTED], meta: { imageIds: ['1'] } })),
      deps(),
    )
    expect(result).toEqual({ skip: 'image' })
  })
})

// ---------------------------------------------------------------------------
// rebuildImages: messages and no images
// ---------------------------------------------------------------------------

describe('rebuildImages on messages', () => {
  it('skips a span whose messages carry an omitted data-uri part', async () => {
    const result = await rebuildImages(
      span(
        logged({
          messages: [{ role: 'user', content: [{ type: 'text', text: 'look' }, OMITTED] }],
        }),
      ),
      deps(),
    )
    expect(result).toEqual({ skip: 'image' })
  })

  it('leaves a request without images untouched', async () => {
    const result = await rebuildImages(span(logged({ system: 's', user: 'u' })), deps())
    expect(result).toEqual({ images: undefined })
  })
})

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function stored(message: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    provider: 'openai',
    ok: true,
    status: 200,
    response: { choices: [{ message, finish_reason: 'stop' }] },
    ...extra,
  }
}

describe('normalizeStored vs normalizeFresh', () => {
  it('treats wire tool_calls and parsed toolCalls as the same shape', () => {
    const fromStored = normalizeStored(
      stored({
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'submit_plan', arguments: '{"steps":["a"]}' } }],
      }),
    )
    const fromFresh = normalizeFresh({
      content: null,
      toolCalls: [{ id: 'c9', name: 'submit_plan', args: { steps: ['a'] } }],
    })
    expect(fromStored).toEqual({ kind: 'tools', calls: [{ name: 'submit_plan', args: { steps: ['a'] } }] })
    expect(fromFresh).toEqual(fromStored)
  })

  it('trims stored content to match the trimmed fresh content', () => {
    const fromStored = normalizeStored(stored({ content: '  {"verdict":"keep"}\n' }))
    const fromFresh = normalizeFresh({ content: '{"verdict":"keep"}', toolCalls: null })
    expect(fromStored).toEqual({ kind: 'json', value: { verdict: 'keep' } })
    expect(fromFresh).toEqual(fromStored)
  })

  it('falls back to text when the content is not JSON', () => {
    expect(normalizeStored(stored({ content: ' 好物 ' }))).toEqual({ kind: 'text', value: '好物' })
    expect(normalizeFresh({ content: '好物', toolCalls: null })).toEqual({ kind: 'text', value: '好物' })
  })

  it('reads only .response from a merged descriptions raw_response', () => {
    const merged = stored(
      { content: '{"description":"model text"}' },
      { parsed: { description: 'post-validation text' }, validationRejections: [{ field: 'description' }] },
    )
    expect(normalizeStored(merged)).toEqual({ kind: 'json', value: { description: 'model text' } })
  })
})
