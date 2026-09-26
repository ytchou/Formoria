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
  writeGoldenItems,
  type GoldenWriteApi,
  type GoldenWriteBody,
} from '../llm-eval'
import { assertCensusTarget } from '../../enrichment/eval/production-guard'
import { PRODUCTION_PROJECT_REF } from '@/lib/supabase/project-target'
import type { GoldenItemBody } from '@/lib/services/eval/golden-capture'
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
      allowVariableChange: false,
    })
  })

  it('parses --allow-variable-change on prompt promote', () => {
    expect(
      parseCliArgs(['prompt', 'promote', 'sentry-classify', '2', '--allow-variable-change']),
    ).toEqual({
      command: 'prompt-promote',
      name: 'sentry-classify',
      version: 2,
      allowVariableChange: true,
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

  it('writes the prompts that fetched, logs fetch errors, and exits 1', async () => {
    const snapshot: SnapshotFile = {
      prompts: {
        descriptions: { version: 1, text: ['old'] },
        'sentry-classify': { version: 1, text: ['old classify'] },
      },
    }

    const api: PromptApi = {
      promptsGet: vi.fn(async ({ promptName }) => {
        if (promptName === 'sentry-classify') throw new Error('No production label')
        return { version: 5, prompt: 'new desc', labels: ['production'] }
      }),
      promptsCreate: vi.fn(),
      promptVersionUpdate: vi.fn(),
    }

    const logs: string[] = []
    let writtenContent = ''
    const exitCode = await handlePromptPull({
      add: [],
      check: false,
      allowVariableChange: false,
      deps: {
        api,
        log: (msg: string) => logs.push(msg),
        readFile: () => JSON.stringify(snapshot),
        writeFile: (_path: string, content: string) => {
          writtenContent = content
        },
      },
    })

    expect(exitCode).toBe(1)
    expect(logs).toContain('fetch error: sentry-classify (No production label)')
    const parsed = JSON.parse(writtenContent)
    expect(parsed.prompts.descriptions.version).toBe(5)
    expect(parsed.prompts['sentry-classify'].version).toBe(1)
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

  it('admits ACTIVE unreviewed items only when allowUnreviewed is true', () => {
    const item = {
      status: 'ACTIVE',
      metadata: { humanApproval: { status: 'pending' } },
    }
    expect(isAdmittedProductsItem(item, false)).toBe(false)
    expect(isAdmittedProductsItem(item, true)).toBe(true)
  })

  it('rejects non-ACTIVE items even when allowUnreviewed', () => {
    const item = {
      status: 'ARCHIVED',
      metadata: { humanApproval: { status: 'pending' } },
    }
    expect(isAdmittedProductsItem(item, false)).toBe(false)
    expect(isAdmittedProductsItem(item, true)).toBe(false)
  })
})

describe('parseCliArgs — dataset harvest / capture (DEV-1873)', () => {
  it('parses dataset harvest --dataset --since --limit', () => {
    expect(
      parseCliArgs([
        'dataset', 'harvest',
        '--dataset', 'acquisition-plan-golden',
        '--since', '2026-09-07',
        '--limit', '20',
      ]),
    ).toEqual({
      command: 'dataset-harvest',
      dataset: 'acquisition-plan-golden',
      since: '2026-09-07',
      limit: 20,
      confirm: false,
    })
  })

  it('parses dataset harvest with only --dataset', () => {
    expect(parseCliArgs(['dataset', 'harvest', '--dataset', 'products-repair-golden'])).toEqual({
      command: 'dataset-harvest',
      dataset: 'products-repair-golden',
      since: undefined,
      limit: undefined,
      confirm: false,
    })
  })

  it('rejects a harvest without --dataset, an unknown dataset, or a bad --limit or --since', () => {
    expect(() => parseCliArgs(['dataset', 'harvest'])).toThrow('--dataset is required')
    expect(() => parseCliArgs(['dataset', 'harvest', '--dataset', 'detect-confidence-golden'])).toThrow(
      'not a capture/harvest golden dataset',
    )
    expect(() =>
      parseCliArgs(['dataset', 'harvest', '--dataset', 'products-repair-golden', '--limit', '0']),
    ).toThrow('--limit must be a positive integer')
    expect(() =>
      parseCliArgs(['dataset', 'harvest', '--dataset', 'products-repair-golden', '--since', 'soon']),
    ).toThrow('--since must be a date')
  })

  it('parses dataset capture --brands a,b --datasets x,y', () => {
    expect(
      parseCliArgs([
        'dataset', 'capture',
        '--brands', 'brand-a,brand-b',
        '--datasets', 'acquisition-plan-golden,acquisition-critique-golden',
      ]),
    ).toEqual({
      command: 'dataset-capture',
      brands: ['brand-a', 'brand-b'],
      datasets: ['acquisition-plan-golden', 'acquisition-critique-golden'],
      confirm: false,
    })
  })

  it('parses dataset capture without --datasets', () => {
    expect(parseCliArgs(['dataset', 'capture', '--brands', 'brand-a'])).toEqual({
      command: 'dataset-capture',
      brands: ['brand-a'],
      datasets: undefined,
      confirm: false,
    })
  })

  it('rejects a capture without --brands or with an unknown dataset', () => {
    expect(() => parseCliArgs(['dataset', 'capture'])).toThrow('--brands is required')
    expect(() =>
      parseCliArgs(['dataset', 'capture', '--brands', 'a', '--datasets', 'descriptions']),
    ).toThrow('not a capture/harvest golden dataset')
  })
})

describe('dataset harvest / capture production guard (DEV-1873 G17)', () => {
  const productionUrl = `https://${PRODUCTION_PROJECT_REF}.supabase.co`

  it('parses --confirm for harvest and capture', () => {
    expect(
      parseCliArgs(['dataset', 'harvest', '--dataset', 'products-repair-golden', '--confirm']),
    ).toMatchObject({ command: 'dataset-harvest', confirm: true })
    expect(parseCliArgs(['dataset', 'capture', '--brands', 'a', '--confirm'])).toMatchObject({
      command: 'dataset-capture',
      confirm: true,
    })
  })

  it('refuses a production target without --confirm', () => {
    for (const args of [
      ['dataset', 'harvest', '--dataset', 'products-repair-golden'],
      ['dataset', 'capture', '--brands', 'a'],
    ]) {
      const parsed = parseCliArgs(args) as { confirm: boolean }
      expect(() =>
        assertCensusTarget({ supabaseUrl: productionUrl, target: 'production', confirmed: parsed.confirm }),
      ).toThrow('without --confirm')
    }
  })

  it('lets a confirmed production run through', () => {
    const parsed = parseCliArgs(['dataset', 'capture', '--brands', 'a', '--confirm']) as { confirm: boolean }
    expect(() =>
      assertCensusTarget({ supabaseUrl: productionUrl, target: 'production', confirmed: parsed.confirm }),
    ).not.toThrow()
  })
})

describe('writeGoldenItems (DEV-1873 G2/S1a)', () => {
  const item = (id: string, datasetName = 'acquisition-plan-golden'): GoldenItemBody => ({
    datasetName,
    id,
    input: 'user text',
    expectedOutput: null,
    status: 'ACTIVE',
    metadata: {
      source: 'harvest',
      brandSlug: 'brand-a',
      jobId: null,
      context: null,
      humanApproval: { status: 'pending' },
    },
  })
  const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status })
  const noSleep = async () => {}

  /** `existing` maps an id to the item Langfuse returns for it; absent ids 404. */
  function fakeApi(existing: Record<string, unknown> = {}, overrides: Partial<GoldenWriteApi> = {}) {
    const created: string[] = []
    const bodies: GoldenWriteBody[] = []
    const api: GoldenWriteApi = {
      getDataset: vi.fn(async () => ({})),
      createDataset: vi.fn(async () => ({})),
      getItem: vi.fn(async (id: string) => {
        if (!(id in existing)) throw httpError(404)
        return existing[id]
      }),
      createItem: vi.fn(async (body) => {
        created.push(body.id)
        bodies.push(body)
        return { id: body.id }
      }),
      ...overrides,
    }
    return { api, created, bodies }
  }

  const rejected = {
    id: 'kept',
    status: 'ARCHIVED',
    metadata: { humanApproval: { status: 'rejected', reviewedVia: { queueId: 'q', scoreId: 's' } } },
  }

  it('skips an item that already exists as rejected (per-id lookup, not the list)', async () => {
    const { api, created } = fakeApi({ kept: rejected })
    const result = await writeGoldenItems([item('kept'), item('new')], { api, sleep: noSleep, minIntervalMs: 0 })
    expect(result).toEqual({ written: 1, reactivated: 0, existing: 1, failed: [] })
    expect(created).toEqual(['new'])
  })

  it('skips existing reviewed and ACTIVE items without re-writing them', async () => {
    const { api, created } = fakeApi({
      reviewed: {
        id: 'reviewed',
        status: 'ACTIVE',
        metadata: { humanApproval: { status: 'approved', reviewedVia: { queueId: 'q', scoreId: 's' } } },
      },
      'archived-reviewed': {
        id: 'archived-reviewed',
        status: 'ARCHIVED',
        metadata: { humanApproval: { status: 'pending', reviewedVia: { queueId: 'q', scoreId: 's' } } },
      },
      'active-pending': {
        id: 'active-pending',
        status: 'ACTIVE',
        metadata: { humanApproval: { status: 'pending' } },
      },
      'archived-bare': { id: 'archived-bare', status: 'ARCHIVED' },
    })
    const result = await writeGoldenItems(
      [item('reviewed'), item('archived-reviewed'), item('active-pending'), item('archived-bare')],
      { api, sleep: noSleep, minIntervalMs: 0 },
    )
    expect(result).toEqual({ written: 0, reactivated: 0, existing: 4, failed: [] })
    expect(created).toEqual([])
  })

  it('reactivates an ARCHIVED pending item as ACTIVE, keeping its stored input, expectedOutput and metadata', async () => {
    const stored = {
      id: 'legacy',
      datasetId: 'ds-1',
      status: 'ARCHIVED',
      input: 'stored user text',
      expectedOutput: { decisions: [{ candidateUrl: 'https://shop.com/a' }] },
      metadata: {
        source: 'capture',
        prelabel: { author: 'system', status: 'draft' },
        humanApproval: { status: 'pending' },
      },
    }
    const { api, bodies } = fakeApi({ legacy: stored })
    const result = await writeGoldenItems([item('legacy')], { api, sleep: noSleep, minIntervalMs: 0 })
    expect(result).toEqual({ written: 0, reactivated: 1, existing: 0, failed: [] })
    expect(bodies).toEqual([
      {
        datasetName: 'acquisition-plan-golden',
        id: 'legacy',
        input: 'stored user text',
        expectedOutput: stored.expectedOutput,
        status: 'ACTIVE',
        metadata: stored.metadata,
      },
    ])
  })

  it('reports an unconfirmed reactivation as failed', async () => {
    const { api } = fakeApi(
      { legacy: { id: 'legacy', status: 'ARCHIVED', input: 'x', metadata: { humanApproval: { status: 'pending' } } } },
      { createItem: vi.fn(async () => ({})) },
    )
    const result = await writeGoldenItems([item('legacy')], { api, sleep: noSleep, minIntervalMs: 0, retries: 2 })
    expect(result).toEqual({ written: 0, reactivated: 0, existing: 0, failed: ['legacy'] })
  })

  it('creates the dataset only on a genuine 404', async () => {
    const { api } = fakeApi({}, { getDataset: vi.fn(async () => Promise.reject(httpError(404))) })
    await writeGoldenItems([item('a')], { api, sleep: noSleep, minIntervalMs: 0 })
    expect(api.createDataset).toHaveBeenCalledTimes(1)
  })

  it('aborts without writing when the dataset read fails for any other reason', async () => {
    const { api, created } = fakeApi({}, {
      getDataset: vi.fn(async () => Promise.reject(httpError(500))),
    })
    await expect(
      writeGoldenItems([item('a')], { api, sleep: noSleep, minIntervalMs: 0 }),
    ).rejects.toThrow('HTTP 500')
    expect(api.createDataset).not.toHaveBeenCalled()
    expect(created).toEqual([])
  })

  it('aborts when an item lookup fails with a non-404 error', async () => {
    const { api, created } = fakeApi({}, {
      getItem: vi.fn(async () => Promise.reject(httpError(500))),
    })
    await expect(
      writeGoldenItems([item('a')], { api, sleep: noSleep, minIntervalMs: 0 }),
    ).rejects.toThrow('HTTP 500')
    expect(created).toEqual([])
  })

  it('retries a create that resolved without an id (the SDK swallows 429) and counts only confirmed writes', async () => {
    let calls = 0
    const { api } = fakeApi({}, {
      createItem: vi.fn(async (body) => {
        calls += 1
        if (body.id === 'flaky' && calls === 1) return 'Rate limit exceeded'
        if (body.id === 'dead') return {}
        return { id: body.id }
      }),
    })
    const sleep = vi.fn(async () => {})
    const result = await writeGoldenItems([item('flaky'), item('dead')], {
      api,
      sleep,
      minIntervalMs: 0,
      retries: 3,
    })
    expect(result).toEqual({ written: 1, reactivated: 0, existing: 0, failed: ['dead'] })
    expect(sleep).toHaveBeenCalled()
  })

  it('retries a lookup that hit 429', async () => {
    let calls = 0
    const { api, created } = fakeApi({}, {
      getItem: vi.fn(async () => {
        calls += 1
        throw httpError(calls === 1 ? 429 : 404)
      }),
    })
    const result = await writeGoldenItems([item('a')], { api, sleep: noSleep, minIntervalMs: 0 })
    expect(result.written).toBe(1)
    expect(created).toEqual(['a'])
  })

  it('paces calls at least minIntervalMs apart', async () => {
    const { api } = fakeApi()
    const waits: number[] = []
    let clock = 0
    await writeGoldenItems([item('a'), item('b')], {
      api,
      minIntervalMs: 700,
      now: () => clock,
      sleep: async (ms: number) => {
        waits.push(ms)
        clock += ms
      },
    })
    // datasetGet, then get+create per item: 5 calls, 4 paced gaps.
    expect(waits.filter((ms) => ms === 700)).toHaveLength(4)
  })
})
