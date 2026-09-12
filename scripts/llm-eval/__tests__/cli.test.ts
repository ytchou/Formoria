import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  parseCliArgs,
  parseArm,
  applyEnvFile,
  handlePromptPush,
  handlePromptPull,
  handlePromptPromote,
  isReviewed,
  isAdmittedProductsItem,
  LANGFUSE_SNAPSHOT_PATH,
} from '../llm-eval'
import type { PromptApi, SnapshotFile } from '@/lib/services/eval/prompt-sync'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TMP = mkdtempSync(join(tmpdir(), 'llm-eval-test-'))

// ---------------------------------------------------------------------------
// parseCliArgs
// ---------------------------------------------------------------------------

describe('parseCliArgs', () => {
  it('parses subcommands dataset validate | dataset review enqueue | dataset review push | run | prompt push', () => {
    // dataset validate
    expect(parseCliArgs(['dataset', 'validate'])).toEqual({
      command: 'dataset-validate',
      allowUnreviewed: false,
    })

    // dataset review enqueue
    expect(
      parseCliArgs([
        'dataset',
        'review',
        'enqueue',
        '--dataset',
        'detect-confidence-golden',
      ]),
    ).toEqual({
      command: 'dataset-review-enqueue',
      dataset: 'detect-confidence-golden',
    })

    // dataset review push
    expect(
      parseCliArgs([
        'dataset',
        'review',
        'push',
        '--dataset',
        'detect-confidence-golden',
        '--approved-by',
        'patrick',
      ]),
    ).toEqual({
      command: 'dataset-review-push',
      dataset: 'detect-confidence-golden',
      approvedBy: 'patrick',
    })

    // run
    expect(
      parseCliArgs([
        'run',
        '--dataset',
        'detect-confidence-golden',
        '--arm',
        'prompt:2',
      ]),
    ).toEqual({
      command: 'run',
      dataset: 'detect-confidence-golden',
      arms: [{ kind: 'prompt', version: 2 }],
      envFile: undefined,
      allowUnreviewed: false,
    })

    // prompt push (positional is the name now)
    expect(
      parseCliArgs(['prompt', 'push', 'descriptions']),
    ).toEqual({
      command: 'prompt-push',
      name: 'descriptions',
      file: undefined,
      label: undefined,
      allowVariableChange: false,
    })
  })
})

// ---------------------------------------------------------------------------
// parseArm
// ---------------------------------------------------------------------------

describe('parseArm', () => {
  it('parses --arm prompt:2 and --arm model:gpt-4o-mini into arm specs', () => {
    expect(parseArm('prompt:2')).toEqual({ kind: 'prompt', version: 2 })
    expect(parseArm('model:gpt-4o-mini')).toEqual({
      kind: 'model',
      model: 'gpt-4o-mini',
    })
  })

  it('throws on a malformed arm spec', () => {
    expect(() => parseArm('invalid')).toThrow()
    expect(() => parseArm('prompt:')).toThrow()
    expect(() => parseArm('prompt:abc')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// applyEnvFile
// ---------------------------------------------------------------------------

describe('applyEnvFile', () => {
  it('is applied before loadScriptTarget and does not override an already-set variable', () => {
    const envFile = join(TMP, 'test.env')
    writeFileSync(envFile, 'EXISTING=overridden\nNEW_VAR=added')

    const env: Record<string, string | undefined> = { EXISTING: 'keep' }
    applyEnvFile(envFile, env)

    // override: false means existing vars are preserved
    expect(env.EXISTING).toBe('keep')
    // New vars from the file are set
    expect(env.NEW_VAR).toBe('added')
  })
})

// ---------------------------------------------------------------------------
// handlePromptPush
// ---------------------------------------------------------------------------

describe('parseCliArgs — pairwise', () => {
  it('parses pairwise run --phase descriptions --target production --sample 20 --arm prompt:production --arm prompt:2', () => {
    expect(
      parseCliArgs([
        'pairwise',
        'run',
        '--phase',
        'descriptions',
        '--target',
        'production',
        '--sample',
        '20',
        '--arm',
        'prompt:1',
        '--arm',
        'prompt:2',
      ]),
    ).toEqual({
      command: 'pairwise-run',
      phase: 'descriptions',
      target: 'production',
      sample: 20,
      arms: [
        { kind: 'prompt', version: 1 },
        { kind: 'prompt', version: 2 },
      ],
      envFile: undefined,
      noEnqueue: false,
      allowUnreviewed: false,
    })
  })

  it('parses pairwise report <runName>', () => {
    expect(parseCliArgs(['pairwise', 'report', 'my-run-2026'])).toEqual({
      command: 'pairwise-report',
      runName: 'my-run-2026',
    })
  })
})

// ---------------------------------------------------------------------------
// dataset record / prelabel
// ---------------------------------------------------------------------------

describe('parseCliArgs — dataset record / prelabel', () => {
  it('parses dataset record --dataset --brand --target production --urls a,b', () => {
    expect(
      parseCliArgs([
        'dataset',
        'record',
        '--dataset',
        'products-agent-ranking-golden',
        '--brand',
        'test-brand',
        '--urls',
        'https://a.com,https://b.com',
      ]),
    ).toEqual({
      command: 'dataset-record',
      dataset: 'products-agent-ranking-golden',
      brand: 'test-brand',
      urls: ['https://a.com', 'https://b.com'],
    })
  })

  it('parses dataset record without --urls', () => {
    expect(
      parseCliArgs([
        'dataset',
        'record',
        '--dataset',
        'products-agent-ranking-golden',
        '--brand',
        'my-brand',
      ]),
    ).toEqual({
      command: 'dataset-record',
      dataset: 'products-agent-ranking-golden',
      brand: 'my-brand',
      urls: undefined,
    })
  })

  it('parses dataset prelabel --dataset --item --file', () => {
    expect(
      parseCliArgs([
        'dataset',
        'prelabel',
        '--dataset',
        'products-agent-ranking-golden',
        '--item',
        'item-123',
        '--file',
        '/tmp/expected.json',
      ]),
    ).toEqual({
      command: 'dataset-prelabel',
      dataset: 'products-agent-ranking-golden',
      item: 'item-123',
      file: '/tmp/expected.json',
    })
  })
})

// ---------------------------------------------------------------------------
// pairwise run products / --no-enqueue
// ---------------------------------------------------------------------------

describe('parseCliArgs — pairwise run products / --no-enqueue', () => {
  it('pairwise run --phase products --arm prompt:2 --arm prompt:3', () => {
    expect(
      parseCliArgs([
        'pairwise',
        'run',
        '--phase',
        'products',
        '--arm',
        'prompt:2',
        '--arm',
        'prompt:3',
      ]),
    ).toEqual({
      command: 'pairwise-run',
      phase: 'products',
      target: 'staging',
      sample: 20,
      arms: [
        { kind: 'prompt', version: 2 },
        { kind: 'prompt', version: 3 },
      ],
      envFile: undefined,
      noEnqueue: false,
      allowUnreviewed: false,
    })
  })

  it('pairwise run accepts --no-enqueue', () => {
    const parsed = parseCliArgs([
      'pairwise',
      'run',
      '--phase',
      'descriptions',
      '--arm',
      'prompt:1',
      '--arm',
      'prompt:2',
      '--no-enqueue',
    ])
    expect(parsed).toMatchObject({
      command: 'pairwise-run',
      noEnqueue: true,
    })
  })
})

// ---------------------------------------------------------------------------
// prompt push / pull / promote — parseCliArgs
// ---------------------------------------------------------------------------

describe('parseCliArgs — prompt push', () => {
  it('parses prompt push name with optional file, label, and allow flag', () => {
    expect(
      parseCliArgs([
        'prompt', 'push', 'descriptions',
        '--file', 'd.md',
        '--label', 'production',
        '--allow-variable-change',
      ]),
    ).toEqual({
      command: 'prompt-push',
      name: 'descriptions',
      file: 'd.md',
      label: 'production',
      allowVariableChange: true,
    })

    // Minimal: just the name
    expect(parseCliArgs(['prompt', 'push', 'descriptions'])).toEqual({
      command: 'prompt-push',
      name: 'descriptions',
      file: undefined,
      label: undefined,
      allowVariableChange: false,
    })

    // --label other than 'production' throws
    expect(() =>
      parseCliArgs(['prompt', 'push', 'detect', '--label', 'staging']),
    ).toThrow()
  })
})

describe('parseCliArgs — prompt pull', () => {
  it('parses prompt pull flags', () => {
    expect(
      parseCliArgs([
        'prompt', 'pull',
        '--add', 'faq-custom',
        '--add', 'faq-where-to-buy',
        '--check',
      ]),
    ).toEqual({
      command: 'prompt-pull',
      add: ['faq-custom', 'faq-where-to-buy'],
      check: true,
      allowVariableChange: false,
    })
  })
})

describe('parseCliArgs — prompt promote', () => {
  it('parses prompt promote positional version', () => {
    expect(
      parseCliArgs(['prompt', 'promote', 'detect', '4']),
    ).toEqual({
      command: 'prompt-promote',
      name: 'detect',
      version: 4,
    })
  })

  it('throws on non-integer version', () => {
    expect(() =>
      parseCliArgs(['prompt', 'promote', 'detect', 'abc']),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// handlePromptPush
// ---------------------------------------------------------------------------

describe('handlePromptPush', () => {
  it('reads snapshot by default and file when given', async () => {
    const snapshot: SnapshotFile = {
      prompts: {
        detect: { version: 2, text: ['snapshot text'] },
      },
    }

    const api: PromptApi = {
      promptsGet: vi.fn(async () => ({
        version: 1,
        prompt: 'old text',
        labels: ['latest'],
      })),
      promptsCreate: vi.fn(async () => ({ name: 'detect', version: 3 })),
      promptVersionUpdate: vi.fn(),
    }

    const logs: string[] = []
    const deps = {
      api,
      log: (msg: string) => logs.push(msg),
      readFile: vi.fn((path: string) => {
        if (path === LANGFUSE_SNAPSHOT_PATH) {
          return JSON.stringify(snapshot)
        }
        return 'file contents here'
      }),
      writeFile: vi.fn(),
    }

    // Without --file: uses snapshot entry text
    await handlePromptPush({ name: 'detect', deps })
    expect(api.promptsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'snapshot text' }),
    )
    expect(logs.join('\n')).toContain('detect v3')

    // With --file: uses file contents
    vi.mocked(api.promptsCreate).mockClear()
    logs.length = 0
    vi.mocked(api.promptsGet).mockResolvedValue({
      version: 3,
      prompt: 'file contents here',
      labels: ['latest'],
    })

    await handlePromptPush({ name: 'detect', file: 'd.md', deps })
    expect(logs.join('\n')).toContain('unchanged, skipped')
  })
})

// ---------------------------------------------------------------------------
// handlePromptPull
// ---------------------------------------------------------------------------

describe('handlePromptPull', () => {
  it('writes snapshot file and exit code', async () => {
    const snapshot: SnapshotFile = {
      prompts: {
        descriptions: { version: 1, text: ['old'] },
        detect: { version: 1, text: ['old detect'] },
      },
    }

    const api: PromptApi = {
      promptsGet: vi.fn(async ({ promptName }) => ({
        version: promptName === 'descriptions' ? 5 : 3,
        prompt: `${promptName} text`,
        labels: ['production'],
      })),
      promptsCreate: vi.fn(),
      promptVersionUpdate: vi.fn(),
    }

    const logs: string[] = []
    let writtenPath = ''
    let writtenContent = ''
    const deps = {
      api,
      log: (msg: string) => logs.push(msg),
      readFile: (_path: string) => JSON.stringify(snapshot),
      writeFile: (path: string, content: string) => {
        writtenPath = path
        writtenContent = content
      },
    }

    const exitCode = await handlePromptPull({
      add: [],
      check: false,
      allowVariableChange: false,
      deps,
    })

    expect(exitCode).toBe(0)
    expect(writtenPath).toBe(LANGFUSE_SNAPSHOT_PATH)
    // 2-space indent + trailing newline
    expect(writtenContent).toMatch(/^\{[\s\S]*\}\n$/)
    const parsed = JSON.parse(writtenContent)
    expect(parsed.prompts.descriptions.version).toBe(5)

    // --check with drift returns exit code 1 without writing
    const checkDeps = {
      ...deps,
      writeFile: vi.fn(),
    }
    const checkExitCode = await handlePromptPull({
      add: [],
      check: true,
      allowVariableChange: false,
      deps: checkDeps,
    })
    expect(checkExitCode).toBe(1)
    expect(checkDeps.writeFile).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// handlePromptPromote
// ---------------------------------------------------------------------------

describe('handlePromptPromote', () => {
  it('calls sync then pull', async () => {
    const snapshot: SnapshotFile = {
      prompts: {
        detect: { version: 3, text: ['hello {{x}} world'] },
      },
    }

    const api: PromptApi = {
      promptsGet: vi.fn(async ({ version }) => {
        // version fetch for parity check
        if (version === 4) {
          return { version: 4, prompt: 'updated {{x}} content', labels: [] }
        }
        // production fetch for pull
        return { version: 4, prompt: 'updated {{x}} content', labels: ['production'] }
      }),
      promptsCreate: vi.fn(),
      promptVersionUpdate: vi.fn(async () => ({})),
    }

    const logs: string[] = []
    let writtenContent = ''
    const deps = {
      api,
      log: (msg: string) => logs.push(msg),
      readFile: (_path: string) => JSON.stringify(snapshot),
      writeFile: (_path: string, content: string) => {
        writtenContent = content
      },
    }

    const exitCode = await handlePromptPromote({
      name: 'detect',
      version: 4,
      deps,
    })

    expect(exitCode).toBe(0)
    expect(api.promptVersionUpdate).toHaveBeenCalledWith('detect', 4, {
      newLabels: ['production'],
    })
    // Snapshot was written with the pulled version
    const parsed = JSON.parse(writtenContent)
    expect(parsed.prompts.detect.version).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// isReviewed
// ---------------------------------------------------------------------------

describe('isReviewed', () => {
  it('requires humanApproval.reviewedVia', () => {
    // Bulk-approved: has humanApproval but no reviewedVia → unreviewed
    expect(
      isReviewed({
        metadata: { humanApproval: { status: 'approved' } },
      }),
    ).toBe(false)

    // Human-reviewed via queue: has reviewedVia → reviewed
    expect(
      isReviewed({
        metadata: {
          humanApproval: {
            status: 'approved',
            reviewedVia: { queueId: 'q-1', scoreId: 's-1' },
          },
        },
      }),
    ).toBe(true)

    // No humanApproval at all → unreviewed
    expect(isReviewed({ metadata: {} })).toBe(false)

    // No metadata → unreviewed
    expect(isReviewed({})).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseCliArgs — pairwise --allow-unreviewed
// ---------------------------------------------------------------------------

describe('parseCliArgs — pairwise --allow-unreviewed', () => {
  it('pairwise run parses --allow-unreviewed', () => {
    const result = parseCliArgs([
      'pairwise', 'run',
      '--phase', 'products',
      '--arm', 'prompt:1',
      '--arm', 'prompt:2',
      '--allow-unreviewed',
    ])
    expect(result).toMatchObject({
      command: 'pairwise-run',
      allowUnreviewed: true,
    })
  })

  it('pairwise run defaults allowUnreviewed to false', () => {
    const result = parseCliArgs([
      'pairwise', 'run',
      '--phase', 'products',
      '--arm', 'prompt:1',
      '--arm', 'prompt:2',
    ])
    expect(result).toMatchObject({
      command: 'pairwise-run',
      allowUnreviewed: false,
    })
  })
})

// ---------------------------------------------------------------------------
// isAdmittedProductsItem
// ---------------------------------------------------------------------------

describe('isAdmittedProductsItem', () => {
  it('admits ACTIVE reviewed items regardless of allowUnreviewed', () => {
    const item = {
      status: 'ACTIVE',
      metadata: { humanApproval: { status: 'approved', reviewedVia: 'manual' } },
    }
    expect(isAdmittedProductsItem(item, false)).toBe(true)
    expect(isAdmittedProductsItem(item, true)).toBe(true)
  })

  it('admits pending archived items only when allowUnreviewed is true', () => {
    const item = {
      status: 'ARCHIVED',
      metadata: { humanApproval: { status: 'pending' } },
    }
    expect(isAdmittedProductsItem(item, false)).toBe(false)
    expect(isAdmittedProductsItem(item, true)).toBe(true)
  })

  it('rejects ARCHIVED items without pending approval even when allowUnreviewed', () => {
    const item = {
      status: 'ARCHIVED',
      metadata: { humanApproval: { status: 'approved', reviewedVia: 'manual' } },
    }
    expect(isAdmittedProductsItem(item, true)).toBe(false)
  })
})
