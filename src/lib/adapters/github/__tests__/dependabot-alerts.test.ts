import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from '@/lib/audit'
import { ExternalServiceError } from '@/lib/errors'
import { createGitHubDependabotAlertsAdapter } from '../dependabot-alerts'

const repository = 'ytchou/Formoria'
const firstPageUrl =
  'https://api.github.com/repos/ytchou/Formoria/dependabot/alerts?state=open&per_page=100'

function githubAlert(
  number: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    number,
    state: 'open',
    dependency: { package: { name: `package-${number}` } },
    security_advisory: { severity: 'high' },
    ...overrides,
  }
}

let auditRecords: AuditRecord[] = []

beforeEach(() => {
  auditRecords = []
  setAuditWriteSeam(async (record) => {
    auditRecords.push(record)
    return null
  })
})

afterEach(() => {
  resetAuditEmitterForTests()
  vi.restoreAllMocks()
})

describe('GitHub Dependabot alerts adapter', () => {
  it('normalizes a successful open-alert payload', async () => {
    const adapter = createGitHubDependabotAlertsAdapter({
      token: 'github-token',
      repository,
      fetchImpl: vi.fn().mockResolvedValue(
        Response.json([
          githubAlert(41, {
            dependency: undefined,
            security_advisory: { severity: 'CRITICAL' },
            security_vulnerability: { package: { name: 'next' } },
          }),
        ]),
      ),
    })

    await expect(
      adapter.listOpenAlerts({ signal: new AbortController().signal }),
    ).resolves.toEqual([
      { alertId: '41', packageName: 'next', severity: 'critical' },
    ])
  })

  it('follows every next page, forwards the signal, deduplicates alert IDs, and audits each page', async () => {
    const secondPageUrl = `${firstPageUrl}&page=2`
    const signal = new AbortController().signal
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([githubAlert(41)], {
          headers: { Link: `<${secondPageUrl}>; rel="next"` },
        }),
      )
      .mockResolvedValueOnce(
        Response.json([
          githubAlert(41),
          githubAlert(72, {
            security_advisory: { severity: 'medium' },
          }),
        ]),
      )
    const adapter = createGitHubDependabotAlertsAdapter({
      token: 'github-token',
      repository,
      fetchImpl,
    })

    await expect(adapter.listOpenAlerts({ signal })).resolves.toEqual([
      { alertId: '41', packageName: 'package-41', severity: 'high' },
      { alertId: '72', packageName: 'package-72', severity: 'medium' },
    ])
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      firstPageUrl,
      expect.objectContaining({ signal }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      secondPageUrl,
      expect.objectContaining({ signal }),
    )
    const completedAudits = auditRecords.filter(
      (record) =>
        record.provider === 'github' &&
        record.operation === 'list_dependabot_alerts' &&
        record.status === 'succeeded',
    )
    expect(completedAudits).toHaveLength(2)
    expect(completedAudits[1]?.summary).toMatchObject({
      request: { page: 2, state: 'open', perPage: 100 },
      response: {
        httpStatus: 200,
        alerts: [
          { alertId: '41' },
          { alertId: '72' },
        ],
        hasNextPage: false,
      },
    })
    expect(JSON.stringify(completedAudits)).not.toContain('github-token')
  })

  it.each([
    {
      name: 'malformed JSON',
      response: () =>
        new Response('{not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    },
    {
      name: 'an invalid successful payload',
      response: () => Response.json({ alerts: [] }),
    },
  ])(
    'rejects $name without retaining the raw response body',
    async ({ response }) => {
      const adapter = createGitHubDependabotAlertsAdapter({
        token: 'github-token',
        repository,
        fetchImpl: vi.fn().mockResolvedValue(response()),
      })

      const promise = adapter.listOpenAlerts({
        signal: new AbortController().signal,
      })

      await expect(promise).rejects.toBeInstanceOf(ExternalServiceError)
      await expect(promise).rejects.toMatchObject({ httpStatus: 200 })
      await expect(promise).rejects.not.toHaveProperty('responseBody')
    },
  )

  it.each([
    {
      name: 'JSON',
      response: () =>
        Response.json(
          {
            message:
              'Dependabot alerts are disabled. See https://docs.github.com/example token=ghp_private',
          },
          { status: 403 },
        ),
      expected: 'Dependabot alerts are disabled.',
    },
    {
      name: 'non-JSON',
      response: () =>
        new Response('Repository administration permission is required', {
          status: 403,
          headers: { 'content-type': 'text/plain' },
        }),
      expected: 'Repository administration permission is required',
    },
  ])(
    'preserves a safe explanation from a $name HTTP failure',
    async ({ response, expected }) => {
      const adapter = createGitHubDependabotAlertsAdapter({
        token: 'github-token',
        repository,
        fetchImpl: vi.fn().mockResolvedValue(response()),
      })

      const promise = adapter.listOpenAlerts({
        signal: new AbortController().signal,
      })

      await expect(promise).rejects.toMatchObject({
        provider: 'github',
        operation: 'list_dependabot_alerts',
        httpStatus: 403,
        safeMessage: expect.stringContaining(expected),
      })
      await expect(promise).rejects.not.toHaveProperty('responseBody')
    },
  )

  it('rejects a repeated pagination URL before requesting it twice', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json([githubAlert(41)], {
        headers: { Link: `<${firstPageUrl}>; rel="next"` },
      }),
    )
    const adapter = createGitHubDependabotAlertsAdapter({
      token: 'github-token',
      repository,
      fetchImpl,
    })

    await expect(
      adapter.listOpenAlerts({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      httpStatus: 200,
      safeMessage: expect.stringContaining('repeated'),
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([
    { name: 'network', error: new TypeError('fetch failed') },
    {
      name: 'abort',
      error: new DOMException('This operation was aborted', 'AbortError'),
    },
  ])('preserves native $name failures from fetch', async ({ error }) => {
    const adapter = createGitHubDependabotAlertsAdapter({
      token: 'github-token',
      repository,
      fetchImpl: vi.fn().mockRejectedValue(error),
    })

    await expect(
      adapter.listOpenAlerts({ signal: new AbortController().signal }),
    ).rejects.toBe(error)
  })
})
