import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureAlert } from '@/lib/adapters/alerting/sentry'
import { postSlackAlert } from '@/lib/adapters/alerting/slack'
import { resetAuditEmitterForTests, setAuditWriteSeam, type AuditRecord } from '@/lib/audit'
import type { EnrichmentSummary } from '../enrichment-logger'
import {
  hasProviderFailures,
  reportJobFailure,
  reportProviderFailures,
} from '../job-alerts'

vi.mock('@/lib/adapters/alerting/sentry', () => ({
  captureAlert: vi.fn(() => true),
}))
vi.mock('@/lib/adapters/alerting/slack', () => ({
  postSlackAlert: vi.fn(async () => true),
}))

const job = { id: 'job-1', operation: 'enrich', trigger: 'manual' }
let writes: AuditRecord[] = []

function summary(overrides: Partial<EnrichmentSummary> = {}): EnrichmentSummary {
  return {
    success: 3,
    skipped: 1,
    failed: 0,
    providerFailed: 0,
    failedBrands: [],
    durationMs: 1_000,
    ...overrides,
  }
}

beforeEach(() => {
  writes = []
  setAuditWriteSeam(async (record) => {
    writes.push(record)
    return null
  })
  vi.mocked(captureAlert).mockReturnValue(true)
  vi.mocked(postSlackAlert).mockResolvedValue(true)
})

afterEach(() => {
  resetAuditEmitterForTests()
  vi.clearAllMocks()
})

describe('reportProviderFailures', () => {
  it('alerts both adapters when the summary carries provider failures', async () => {
    await reportProviderFailures(
      job,
      summary({
        failed: 2,
        providerFailed: 2,
        failedBrands: [
          {
            slug: 'brand-a',
            phase: 'discover',
            error: 'Search provider unavailable — SERP: Serper HTTP 400',
          },
          {
            slug: 'brand-b',
            phase: 'discover',
            error: 'Search provider unavailable — SERP: Serper HTTP 400',
          },
        ],
      }),
    )

    expect(captureAlert).toHaveBeenCalledTimes(1)
    expect(vi.mocked(captureAlert).mock.calls[0]?.[0]).toContain('job-1')
    expect(vi.mocked(captureAlert).mock.calls[0]?.[1]).toMatchObject({
      context: expect.objectContaining({ providerFailed: 2 }),
    })
    expect(postSlackAlert).toHaveBeenCalledTimes(1)
    expect(vi.mocked(postSlackAlert).mock.calls[0]?.[0]).toMatchObject({
      agent: 'Curation',
      status: 'failed',
    })
  })

  it('does NOT alert when targets failed but no provider failed', async () => {
    // Ordinary data gaps fail targets too — paging on those would make the
    // alert worthless within a week.
    await reportProviderFailures(
      job,
      summary({
        failed: 5,
        providerFailed: 0,
        failedBrands: [
          { slug: 'brand-a', phase: 'descriptions', error: 'No usable inputs' },
        ],
      }),
    )

    expect(captureAlert).not.toHaveBeenCalled()
    expect(postSlackAlert).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })

  it('treats a missing providerFailed count as zero', () => {
    const legacy = summary()
    delete legacy.providerFailed
    expect(hasProviderFailures(legacy)).toBe(false)
  })
})

describe('alerting never fails the job', () => {
  it('resolves normally when the Slack adapter throws', async () => {
    vi.mocked(postSlackAlert).mockRejectedValue(new Error('slack is down'))

    await expect(reportJobFailure(job, new Error('boom'))).resolves.toBeUndefined()
    expect(captureAlert).toHaveBeenCalledTimes(1)
  })

  it('resolves normally when the Sentry adapter throws', async () => {
    vi.mocked(captureAlert).mockImplementation(() => {
      throw new Error('sentry is down')
    })

    await expect(
      reportProviderFailures(job, summary({ failed: 1, providerFailed: 1 })),
    ).resolves.toBeUndefined()
    // Slack still gets its alert — one broken adapter must not silence the other.
    expect(postSlackAlert).toHaveBeenCalledTimes(1)
  })
})

describe('unconfigured adapters', () => {
  const originalWebhook = process.env.SLACK_FORMORIA_WEBHOOK_URL
  const originalDsn = process.env.SENTRY_DSN
  const originalPublicDsn = process.env.NEXT_PUBLIC_SENTRY_DSN

  afterEach(() => {
    if (originalWebhook === undefined) delete process.env.SLACK_FORMORIA_WEBHOOK_URL
    else process.env.SLACK_FORMORIA_WEBHOOK_URL = originalWebhook
    if (originalDsn === undefined) delete process.env.SENTRY_DSN
    else process.env.SENTRY_DSN = originalDsn
    if (originalPublicDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN
    else process.env.NEXT_PUBLIC_SENTRY_DSN = originalPublicDsn
    vi.unstubAllGlobals()
  })

  it('sends nothing and throws nothing when the Slack webhook is missing', async () => {
    delete process.env.SLACK_FORMORIA_WEBHOOK_URL
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const slack = await vi.importActual<
      typeof import('@/lib/adapters/alerting/slack')
    >('@/lib/adapters/alerting/slack')
    slack.resetSlackAdapterForTests()

    await expect(
      slack.postSlackAlert({ agent: 'Curation', status: 'failed', summary: ['•'] }),
    ).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends nothing and throws nothing when the Sentry DSN is missing', async () => {
    delete process.env.SENTRY_DSN
    delete process.env.NEXT_PUBLIC_SENTRY_DSN

    const sentry = await vi.importActual<
      typeof import('@/lib/adapters/alerting/sentry')
    >('@/lib/adapters/alerting/sentry')
    sentry.resetSentryAdapterForTests()

    expect(sentry.captureAlert('provider outage')).toBe(false)
  })
})
