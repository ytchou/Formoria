import { auditedCall } from '@/lib/audit'
import { ExternalServiceError } from '@/lib/errors'
import type {
  DependabotAlertRecord,
  DependabotAlertsPort,
} from '@/lib/services/health-agent/detectors/dependabot'

const PROVIDER = 'github'
const OPERATION = 'list_dependabot_alerts'
const GITHUB_API_ORIGIN = 'https://api.github.com'

type GitHubDependabotAdapterOptions = {
  token: string
  repository: string
  fetchImpl?: typeof fetch
}

type DependabotPage = {
  alerts: readonly DependabotAlertRecord[]
  nextUrl: string | null
  httpStatus: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const nested = value[key]
  return isRecord(nested) ? nested : null
}

function schemaError(httpStatus: number): ExternalServiceError {
  return new ExternalServiceError(
    PROVIDER,
    OPERATION,
    httpStatus,
    'GitHub returned an invalid Dependabot alerts payload',
  )
}

function normalizeAlert(
  value: unknown,
  httpStatus: number,
): DependabotAlertRecord {
  if (!isRecord(value)) throw schemaError(httpStatus)

  const number = value.number
  const state = value.state
  const advisory = nestedRecord(value, 'security_advisory')
  const rawSeverity = advisory?.severity
  const dependencyPackage = nestedRecord(
    nestedRecord(value, 'dependency') ?? {},
    'package',
  )
  const vulnerabilityPackage = nestedRecord(
    nestedRecord(value, 'security_vulnerability') ?? {},
    'package',
  )
  const packageName = dependencyPackage?.name ?? vulnerabilityPackage?.name

  if (
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    state !== 'open' ||
    typeof rawSeverity !== 'string' ||
    typeof packageName !== 'string' ||
    !packageName.trim()
  ) {
    throw schemaError(httpStatus)
  }

  const severity = rawSeverity.toLowerCase()
  if (
    severity !== 'low' &&
    severity !== 'medium' &&
    severity !== 'high' &&
    severity !== 'critical'
  ) {
    throw schemaError(httpStatus)
  }

  return {
    alertId: String(number),
    packageName: packageName.trim(),
    severity,
  }
}

function normalizePayload(
  payload: unknown,
  httpStatus: number,
): readonly DependabotAlertRecord[] {
  if (!Array.isArray(payload)) throw schemaError(httpStatus)
  return payload.map((alert) => normalizeAlert(alert, httpStatus))
}

function providerMessage(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === 'string') return parsed
    if (isRecord(parsed) && typeof parsed.message === 'string') {
      return parsed.message
    }
    return null
  } catch {
    return body
  }
}

function nextPageUrl(
  linkHeader: string | null,
  currentUrl: URL,
  endpoint: URL,
  httpStatus: number,
): string | null {
  if (!linkHeader) return null

  for (const segment of linkHeader.split(',')) {
    const match = segment.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/i)
    if (!match) {
      if (/rel\s*=\s*"[^"]*\bnext\b/i.test(segment)) {
        throw new ExternalServiceError(
          PROVIDER,
          OPERATION,
          httpStatus,
          'GitHub returned an invalid Dependabot pagination link',
        )
      }
      continue
    }

    const relations = match[2].split(/\s+/)
    if (!relations.includes('next')) continue

    let next: URL
    try {
      next = new URL(match[1], currentUrl)
    } catch {
      throw new ExternalServiceError(
        PROVIDER,
        OPERATION,
        httpStatus,
        'GitHub returned an invalid Dependabot pagination link',
      )
    }

    if (
      next.origin !== endpoint.origin ||
      next.pathname !== endpoint.pathname
    ) {
      throw new ExternalServiceError(
        PROVIDER,
        OPERATION,
        httpStatus,
        'GitHub returned an unsafe Dependabot pagination link',
      )
    }

    return next.toString()
  }

  return null
}

function dependabotEndpoint(repository: string): URL {
  const parts = repository.split('/')
  if (parts.length !== 2 || parts.some((part) => !part.trim())) {
    throw new Error('GITHUB_REPOSITORY must use the owner/repository format')
  }

  const encodedRepository = parts
    .map((part) => encodeURIComponent(part.trim()))
    .join('/')
  const url = new URL(
    `/repos/${encodedRepository}/dependabot/alerts`,
    GITHUB_API_ORIGIN,
  )
  url.searchParams.set('state', 'open')
  url.searchParams.set('per_page', '100')
  return url
}

export function createGitHubDependabotAlertsAdapter(
  options: GitHubDependabotAdapterOptions,
): DependabotAlertsPort {
  const endpoint = dependabotEndpoint(options.repository)
  const fetchImpl = options.fetchImpl ?? fetch

  async function fetchPage(
    url: string,
    page: number,
    signal: AbortSignal,
  ): Promise<DependabotPage> {
    return auditedCall(
      { provider: PROVIDER, operation: OPERATION, kind: 'external' },
      async (audit) => {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${options.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal,
        })
        const body = await response.text()
        const responseBytes = new TextEncoder().encode(body).byteLength
        audit.summary.response = {
          httpStatus: response.status,
          responseBytes,
        }

        if (!response.ok) {
          const error = new ExternalServiceError(
            PROVIDER,
            OPERATION,
            response.status,
            providerMessage(body),
          )
          audit.summary.response = {
            httpStatus: response.status,
            responseBytes,
            message: error.safeMessage,
          }
          throw error
        }

        let payload: unknown
        try {
          payload = JSON.parse(body)
        } catch {
          throw new ExternalServiceError(
            PROVIDER,
            OPERATION,
            response.status,
            'GitHub returned malformed JSON for Dependabot alerts',
          )
        }

        const alerts = normalizePayload(payload, response.status)
        const nextUrl = nextPageUrl(
          response.headers.get('link'),
          new URL(url),
          endpoint,
          response.status,
        )
        audit.summary.response = {
          httpStatus: response.status,
          responseBytes,
          alerts,
          hasNextPage: nextUrl !== null,
        }

        return { alerts, nextUrl, httpStatus: response.status }
      },
      {
        summary: {
          request: {
            method: 'GET',
            repository: options.repository,
            state: 'open',
            perPage: 100,
            page,
          },
        },
      },
    )
  }

  return {
    async listOpenAlerts({ signal }) {
      const alertsById = new Map<string, DependabotAlertRecord>()
      const visitedUrls = new Set<string>()
      let nextUrl: string | null = endpoint.toString()
      let page = 1
      let lastStatus = 200

      while (nextUrl) {
        if (visitedUrls.has(nextUrl)) {
          throw new ExternalServiceError(
            PROVIDER,
            OPERATION,
            lastStatus,
            'GitHub returned a repeated Dependabot pagination URL',
          )
        }
        visitedUrls.add(nextUrl)

        const result = await fetchPage(nextUrl, page, signal)
        lastStatus = result.httpStatus
        for (const alert of result.alerts) {
          if (!alertsById.has(alert.alertId)) {
            alertsById.set(alert.alertId, alert)
          }
        }
        nextUrl = result.nextUrl
        page += 1
      }

      return [...alertsById.values()]
    },
  }
}
