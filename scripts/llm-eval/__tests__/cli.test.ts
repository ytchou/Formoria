import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  parseCliArgs,
  parseArm,
  applyEnvFile,
  handlePromptPush,
  isReviewed,
} from '../llm-eval'

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

    // prompt push
    expect(
      parseCliArgs([
        'prompt',
        'push',
        '/path/to/prompt.txt',
        '--name',
        'detect',
      ]),
    ).toEqual({
      command: 'prompt-push',
      file: '/path/to/prompt.txt',
      name: 'detect',
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
// handlePromptPush
// ---------------------------------------------------------------------------

describe('handlePromptPush', () => {
  it('reads the file, calls promptsCreate with labels [] and type text, and prints the new version', async () => {
    const promptFile = join(TMP, 'test-prompt.txt')
    writeFileSync(promptFile, 'You are a brand detector.')

    const promptsCreate = vi
      .fn()
      .mockResolvedValue({ name: 'detect', version: 3 })
    const logs: string[] = []

    await handlePromptPush({
      file: promptFile,
      name: 'detect',
      deps: {
        promptsCreate,
        log: (msg: string) => logs.push(msg),
      },
    })

    expect(promptsCreate).toHaveBeenCalledWith({
      name: 'detect',
      prompt: 'You are a brand detector.',
      type: 'text',
      labels: [],
    })

    expect(logs.join('\n')).toContain('detect v3')
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
