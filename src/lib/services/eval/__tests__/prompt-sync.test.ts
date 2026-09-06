import { describe, expect, it, vi } from 'vitest'

import {
  placeholderSet,
  assertPlaceholderParity,
  assertNoInlinedBlocks,
  textToLines,
  linesToText,
  pullSnapshot,
  pushPrompt,
  promotePrompt,
  type SnapshotFile,
  type PromptApi,
} from '../prompt-sync'

// ---------------------------------------------------------------------------
// placeholderSet
// ---------------------------------------------------------------------------

describe('placeholderSet', () => {
  it('extracts unique mustache keys and rejects spaced delimiters', () => {
    expect(placeholderSet('a {{x}} b {{y}} {{x}}')).toEqual(
      new Set(['x', 'y']),
    )
    // Spaces inside delimiters are NOT matched (same regex as prompt.ts)
    expect(placeholderSet('{{ x }}')).toEqual(new Set())
  })
})

// ---------------------------------------------------------------------------
// assertPlaceholderParity
// ---------------------------------------------------------------------------

describe('assertPlaceholderParity', () => {
  it('throws with diff when placeholders differ', () => {
    const snapshotText = 'hello {{taiwan_usage_rules}}'
    const newText = 'hello {{foo}}'
    expect(() =>
      assertPlaceholderParity(newText, snapshotText),
    ).toThrow('+foo')
    expect(() =>
      assertPlaceholderParity(newText, snapshotText),
    ).toThrow('-taiwan_usage_rules')
  })

  it('does not throw when allow is true', () => {
    const snapshotText = 'hello {{taiwan_usage_rules}}'
    const newText = 'hello {{foo}}'
    expect(() =>
      assertPlaceholderParity(newText, snapshotText, { allow: true }),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// assertNoInlinedBlocks
// ---------------------------------------------------------------------------

describe('assertNoInlinedBlocks', () => {
  it('throws naming the inlined block literal', () => {
    const blocks: Record<string, string> = {
      category_list: 'CATEGORY_LIST',
      editorial_bands: 'renderEditorialBands()',
    }

    // Contains the literal constant value — should throw
    expect(() =>
      assertNoInlinedBlocks('foo CATEGORY_LIST bar', blocks),
    ).toThrow('category_list')

    // Contains only the placeholder — should pass
    expect(() =>
      assertNoInlinedBlocks('foo {{category_list}} bar', blocks),
    ).not.toThrow()

    // renderEditorialBands() literal is also refused
    expect(() =>
      assertNoInlinedBlocks('blah renderEditorialBands() blah', blocks),
    ).toThrow('editorial_bands')
  })
})

// ---------------------------------------------------------------------------
// textCodec
// ---------------------------------------------------------------------------

describe('textCodec', () => {
  it('roundtrips text with blank lines and trailing newline', () => {
    const s = 'line1\n\nline3\n'
    expect(linesToText(textToLines(s))).toBe(s)
  })
})

// ---------------------------------------------------------------------------
// pullSnapshot
// ---------------------------------------------------------------------------

describe('pullSnapshot', () => {
  const makeApi = (
    prompts: Record<string, { version: number; prompt: string; labels: string[] }>,
  ): PromptApi => ({
    promptsGet: vi.fn(async ({ promptName, label, version }: { promptName: string; label?: string; version?: number }) => {
      const entry = prompts[promptName]
      if (!entry) throw new Error(`Not found: ${promptName}`)
      if (label && !entry.labels.includes(label)) {
        throw new Error(`No ${label} label for ${promptName}`)
      }
      return { version: version ?? entry.version, prompt: entry.prompt, labels: entry.labels }
    }),
    promptsCreate: vi.fn(),
    promptVersionUpdate: vi.fn(),
  })

  it('writes production versions and warns on unknown remote', async () => {
    const api = makeApi({
      descriptions: { version: 5, prompt: 'desc prompt', labels: ['production'] },
      detect: { version: 3, prompt: 'detect prompt', labels: ['production'] },
      'products-propose': { version: 2, prompt: 'products prompt', labels: ['production'] },
      reputation: { version: 1, prompt: 'reputation prompt', labels: ['production'] },
    })
    const warn = vi.fn()

    const existingSnapshot: SnapshotFile = {
      prompts: {
        descriptions: { version: 1, text: ['old desc'] },
        detect: { version: 1, text: ['old detect'] },
        'products-propose': { version: 1, text: ['old products'] },
      },
    }

    // Simulate Langfuse listing with an extra unknown name
    const result = await pullSnapshot({
      api,
      snapshot: existingSnapshot,
      knownNames: ['descriptions', 'detect', 'products-propose'],
      remoteNames: ['descriptions', 'detect', 'products-propose', 'reputation'],
      warn,
    })

    expect(result.ok).toBe(true)
    expect(result.snapshot!.prompts.descriptions.version).toBe(5)
    expect(result.snapshot!.prompts.detect.version).toBe(3)
    expect(result.snapshot!.prompts['products-propose'].version).toBe(2)
    // text is stored as lines
    expect(result.snapshot!.prompts.descriptions.text).toEqual(['desc prompt'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reputation'))
  })

  it('check mode reports diff and does not write', async () => {
    const api = makeApi({
      descriptions: { version: 5, prompt: 'new prompt', labels: ['production'] },
      detect: { version: 3, prompt: 'detect prompt', labels: ['production'] },
    })

    const existingSnapshot: SnapshotFile = {
      prompts: {
        descriptions: { version: 2, text: ['old prompt'] },
        detect: { version: 3, text: ['detect prompt'] },
      },
    }

    const result = await pullSnapshot({
      api,
      snapshot: existingSnapshot,
      knownNames: ['descriptions', 'detect'],
      remoteNames: ['descriptions', 'detect'],
      check: true,
    })

    expect(result.ok).toBe(false)
    expect(result.drift).toEqual([
      { name: 'descriptions', snapshotVersion: 2, remoteVersion: 5 },
    ])
    // snapshot should not be updated in check mode
    expect(result.snapshot).toBeUndefined()
  })

  it('--add includes a new name', async () => {
    const api = makeApi({
      descriptions: { version: 2, prompt: 'desc', labels: ['production'] },
      'faq-custom': { version: 1, prompt: 'custom faq', labels: ['production'] },
    })

    const existingSnapshot: SnapshotFile = {
      prompts: {
        descriptions: { version: 2, text: ['desc'] },
      },
    }

    const result = await pullSnapshot({
      api,
      snapshot: existingSnapshot,
      knownNames: ['descriptions'],
      remoteNames: ['descriptions', 'faq-custom'],
      add: ['faq-custom'],
    })

    expect(result.ok).toBe(true)
    expect(result.snapshot!.prompts['faq-custom']).toEqual({
      version: 1,
      text: ['custom faq'],
    })
  })

  it('--add rejects a name with no production label', async () => {
    const api: PromptApi = {
      promptsGet: vi.fn(async () => {
        throw new Error('No production label')
      }),
      promptsCreate: vi.fn(),
      promptVersionUpdate: vi.fn(),
    }

    const existingSnapshot: SnapshotFile = {
      prompts: {
        descriptions: { version: 2, text: ['desc'] },
      },
    }

    const result = await pullSnapshot({
      api,
      snapshot: existingSnapshot,
      knownNames: ['descriptions'],
      remoteNames: ['descriptions'],
      add: ['faq-no-prod'],
    })

    expect(result.ok).toBe(false)
    expect(result.rejected).toContain('faq-no-prod')
    // snapshot should not be written
    expect(result.snapshot).toBeUndefined()
  })

  it('refuses placeholder change without flag', async () => {
    const api = makeApi({
      descriptions: { version: 5, prompt: 'hello {{foo}} world', labels: ['production'] },
    })

    const existingSnapshot: SnapshotFile = {
      prompts: {
        descriptions: { version: 2, text: ['hello {{bar}} world'] },
      },
    }

    const result = await pullSnapshot({
      api,
      snapshot: existingSnapshot,
      knownNames: ['descriptions'],
      remoteNames: ['descriptions'],
    })

    expect(result.ok).toBe(false)
    expect(result.placeholderDrift).toBeDefined()
    expect(result.placeholderDrift![0]!.name).toBe('descriptions')
  })

  it('reports fetch errors for known prompts', async () => {
    const api: PromptApi = {
      promptsGet: vi.fn(async ({ promptName }: { promptName: string }) => {
        if (promptName === 'detect') {
          throw new Error('Network timeout')
        }
        return { version: 5, prompt: 'desc prompt', labels: ['production'] }
      }),
      promptsCreate: vi.fn(),
      promptVersionUpdate: vi.fn(),
    }

    const existingSnapshot: SnapshotFile = {
      prompts: {
        descriptions: { version: 1, text: ['old desc'] },
        detect: { version: 1, text: ['old detect'] },
      },
    }

    const result = await pullSnapshot({
      api,
      snapshot: existingSnapshot,
      knownNames: ['descriptions', 'detect'],
      remoteNames: ['descriptions', 'detect'],
    })

    expect(result.ok).toBe(false)
    expect(result.fetchErrors).toBeDefined()
    expect(result.fetchErrors).toHaveLength(1)
    expect(result.fetchErrors![0]!.name).toBe('detect')
    expect(result.fetchErrors![0]!.error).toContain('Network timeout')
  })

  it('allows placeholder change with allowVariableChange', async () => {
    const api = makeApi({
      descriptions: { version: 5, prompt: 'hello {{foo}} world', labels: ['production'] },
    })

    const existingSnapshot: SnapshotFile = {
      prompts: {
        descriptions: { version: 2, text: ['hello {{bar}} world'] },
      },
    }

    const result = await pullSnapshot({
      api,
      snapshot: existingSnapshot,
      knownNames: ['descriptions'],
      remoteNames: ['descriptions'],
      allowVariableChange: true,
    })

    expect(result.ok).toBe(true)
    expect(result.snapshot!.prompts.descriptions.version).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// pushPrompt
// ---------------------------------------------------------------------------

describe('pushPrompt', () => {
  it('skips when latest text is identical', async () => {
    const api: PromptApi = {
      promptsGet: vi.fn(async () => ({
        version: 3,
        prompt: 'same text',
        labels: ['latest'],
      })),
      promptsCreate: vi.fn(),
      promptVersionUpdate: vi.fn(),
    }

    const result = await pushPrompt({
      api,
      name: 'descriptions',
      text: 'same text',
    })

    expect(result.skipped).toBe(true)
    expect(api.promptsCreate).not.toHaveBeenCalled()
  })

  it('creates unlabeled by default and labels on request', async () => {
    const api: PromptApi = {
      promptsGet: vi.fn(async () => ({
        version: 2,
        prompt: 'old text',
        labels: ['latest'],
      })),
      promptsCreate: vi.fn(async () => ({ name: 'detect', version: 3 })),
      promptVersionUpdate: vi.fn(),
    }

    // Default: no labels
    const result1 = await pushPrompt({ api, name: 'detect', text: 'new text' })
    expect(result1.skipped).toBe(false)
    expect(api.promptsCreate).toHaveBeenCalledWith({
      name: 'detect',
      prompt: 'new text',
      type: 'text',
      labels: [],
    })

    // With label
    vi.mocked(api.promptsCreate).mockClear()
    const result2 = await pushPrompt({
      api,
      name: 'detect',
      text: 'new text',
      label: 'production',
    })
    expect(result2.skipped).toBe(false)
    expect(api.promptsCreate).toHaveBeenCalledWith({
      name: 'detect',
      prompt: 'new text',
      type: 'text',
      labels: ['production'],
    })
  })

  it('defaults text to snapshot entry when not given', async () => {
    const snapshot: SnapshotFile = {
      prompts: {
        detect: { version: 2, text: ['line1', 'line2'] },
      },
    }

    const api: PromptApi = {
      promptsGet: vi.fn(async () => ({
        version: 2,
        prompt: 'old text',
        labels: ['latest'],
      })),
      promptsCreate: vi.fn(async () => ({ name: 'detect', version: 3 })),
      promptVersionUpdate: vi.fn(),
    }

    await pushPrompt({ api, name: 'detect', snapshot })

    expect(api.promptsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'line1\nline2',
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// promotePrompt
// ---------------------------------------------------------------------------

describe('promotePrompt', () => {
  it('guards parity then labels then pulls; rejects on parity fail', async () => {
    const snapshotEntry = { version: 3, text: ['hello {{x}} world'] }
    const snapshot: SnapshotFile = {
      prompts: {
        detect: snapshotEntry,
      },
    }

    // API: version 4 text has same placeholders — parity passes
    const api: PromptApi = {
      promptsGet: vi.fn(async ({ version }) => {
        if (version === 4) {
          return { version: 4, prompt: 'updated {{x}} content', labels: [] }
        }
        // production fetch for pull
        return { version: 4, prompt: 'updated {{x}} content', labels: ['production'] }
      }),
      promptsCreate: vi.fn(),
      promptVersionUpdate: vi.fn(async () => ({})),
    }

    const result = await promotePrompt({
      api,
      name: 'detect',
      version: 4,
      snapshot,
      knownNames: ['detect'],
    })

    expect(result.ok).toBe(true)
    expect(api.promptVersionUpdate).toHaveBeenCalledWith('detect', 4, {
      newLabels: ['production'],
    })
  })

  it('returns not ok when post-promote pull fails', async () => {
    const snapshot: SnapshotFile = {
      prompts: {
        detect: { version: 3, text: ['hello {{x}} world'] },
        descriptions: { version: 2, text: ['desc text'] },
      },
    }

    // API: version 4 of detect has same placeholders — parity passes.
    // But descriptions throws on re-fetch (simulating pull failure).
    const api: PromptApi = {
      promptsGet: vi.fn(async ({ promptName, version, label }: { promptName: string; version?: number; label?: string }) => {
        if (promptName === 'detect') {
          if (version === 4) {
            return { version: 4, prompt: 'updated {{x}} content', labels: [] }
          }
          if (label === 'production') {
            return { version: 4, prompt: 'updated {{x}} content', labels: ['production'] }
          }
        }
        if (promptName === 'descriptions') {
          throw new Error('Langfuse API unavailable')
        }
        throw new Error(`Not found: ${promptName}`)
      }),
      promptsCreate: vi.fn(),
      promptVersionUpdate: vi.fn(async () => ({})),
    }

    const result = await promotePrompt({
      api,
      name: 'detect',
      version: 4,
      snapshot,
      knownNames: ['detect', 'descriptions'],
    })

    expect(result.ok).toBe(false)
    expect(result.labelApplied).toBe(true)
    // The label WAS applied before the pull failed
    expect(api.promptVersionUpdate).toHaveBeenCalledWith('detect', 4, {
      newLabels: ['production'],
    })
  })

  it('does not call promptVersionUpdate when parity fails', async () => {
    const snapshot: SnapshotFile = {
      prompts: {
        detect: { version: 3, text: ['hello {{x}} world'] },
      },
    }

    const api: PromptApi = {
      promptsGet: vi.fn(async () => ({
        version: 4,
        prompt: 'hello {{y}} {{z}} world',
        labels: [],
      })),
      promptsCreate: vi.fn(),
      promptVersionUpdate: vi.fn(),
    }

    const result = await promotePrompt({
      api,
      name: 'detect',
      version: 4,
      snapshot,
      knownNames: ['detect'],
    })

    expect(result.ok).toBe(false)
    expect(api.promptVersionUpdate).not.toHaveBeenCalled()
  })
})
