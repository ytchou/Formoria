import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'

import SentryTriageDigestEmail from '@emails/templates/sentry-triage-digest'

const sampleProps = {
  dateRange: '2026-06-20 to 2026-06-21',
  summary: {
    total: 3,
    critical: 1,
    moderate: 1,
    trivial: 0,
    noise: 1,
  },
  issues: [
    {
      title: 'PGRST103: Requested range not satisfiable',
      url: 'https://sentry.io/issues/123',
      eventCount: 14,
      severity: 'critical' as const,
      isNew: false,
      seerAnalysis:
        'Pagination offset exceeds total row count when navigating beyond available data.',
      recommendedAction:
        'Fix pagination logic to clamp offset to max row count.',
    },
    {
      title: 'PGRST205: Column "categories" not found',
      url: 'https://sentry.io/issues/456',
      eventCount: 12,
      severity: 'moderate' as const,
      isNew: false,
      seerAnalysis:
        'Schema mismatch — query references column renamed in recent migration.',
      recommendedAction:
        'Investigate schema drift between service queries and current DB schema.',
    },
    {
      title: 'Bot crawler 404s on /api/health',
      url: 'https://sentry.io/issues/789',
      eventCount: 2,
      severity: 'noise' as const,
      isNew: true,
      seerAnalysis:
        'Automated health check probes from external monitoring bots.',
      recommendedAction: 'Expected behavior — no action needed.',
    },
  ],
  isIncidentMode: false,
  phase: 'Phase 1 — read-only mode',
}

describe('SentryTriageDigestEmail', () => {
  it('renders issues with severity and event count', async () => {
    const html = await render(<SentryTriageDigestEmail {...sampleProps} />)
    expect(html).toContain('PGRST103')
    expect(html).toContain('14')
    expect(html).toContain('Phase 1')
  })

  it('renders all-clear when no issues', async () => {
    const html = await render(
      <SentryTriageDigestEmail
        {...sampleProps}
        summary={{ total: 0, critical: 0, moderate: 0, trivial: 0, noise: 0 }}
        issues={[]}
      />,
    )
    expect(html).toContain('All clear')
  })

  it('shows incident mode banner', async () => {
    const html = await render(
      <SentryTriageDigestEmail {...sampleProps} isIncidentMode={true} />,
    )
    expect(html).toContain('Incident')
  })
})
