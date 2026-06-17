// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SystemStatusCard } from './system-status-card'
import type { ServiceHealthResult } from '@/lib/services/health-checks'

vi.mock('@/app/admin/actions', () => ({
  refreshHealthChecks: vi.fn(),
}))

const makeResult = (
  service: string,
  status: ServiceHealthResult['status'] = 'healthy',
  message = 'OK'
): ServiceHealthResult => ({
  service,
  status,
  message,
  checkedAt: new Date().toISOString(),
})

const allHealthy: ServiceHealthResult[] = [
  makeResult('Supabase'),
  makeResult('Sentry'),
  makeResult('Resend'),
  makeResult('Turnstile'),
  makeResult('Tally'),
  makeResult('Browserless'),
  makeResult('Railway'),
  makeResult('Upstash Redis', 'healthy', '已連線 (42ms)'),
]

describe('SystemStatusCard', () => {
  it('renders a card heading', () => {
    render(<SystemStatusCard initialResults={allHealthy} />)
    expect(screen.getByText(/系統狀態|System Status/i)).toBeInTheDocument()
  })

  it('renders all 8 service names', () => {
    render(<SystemStatusCard initialResults={allHealthy} />)
    for (const svc of ['Supabase', 'Sentry', 'Resend', 'Turnstile', 'Tally', 'Browserless', 'Railway', 'Upstash Redis']) {
      expect(screen.getByText(svc)).toBeInTheDocument()
    }
  })

  it('renders a Refresh button', () => {
    render(<SystemStatusCard initialResults={allHealthy} />)
    expect(screen.getByRole('button', { name: /refresh|重新整理/i })).toBeInTheDocument()
  })

  it('renders the status message for each service', () => {
    const results = [
      makeResult('Supabase', 'healthy', 'Connected'),
      makeResult('Sentry', 'down', 'API unreachable'),
      ...allHealthy.slice(2),
    ]
    render(<SystemStatusCard initialResults={results} />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('API unreachable')).toBeInTheDocument()
  })

  it('renders unconfigured message for unconfigured services', () => {
    const results = allHealthy.map((r) =>
      r.service === 'Browserless'
        ? makeResult('Browserless', 'unconfigured', 'Not configured')
        : r
    )
    render(<SystemStatusCard initialResults={results} />)
    expect(screen.getByText('Not configured')).toBeInTheDocument()
  })

  it('renders empty state without throwing when results array is empty', () => {
    render(<SystemStatusCard initialResults={[]} />)
    expect(screen.getByText(/系統狀態|System Status/i)).toBeInTheDocument()
  })
})
