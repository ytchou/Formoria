// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DashboardContentLayout } from '../dashboard-content-layout'

describe('DashboardContentLayout', () => {
  it('shows the onboarding rail while onboarding is incomplete', () => {
    render(
      <DashboardContentLayout
        onboarding={<div>Onboarding checklist</div>}
        showOnboarding
      >
        <div>Brand information</div>
      </DashboardContentLayout>
    )

    expect(screen.getByRole('complementary')).toHaveTextContent('Onboarding checklist')
    expect(screen.getByText('Brand information')).toBeInTheDocument()
  })

  it('uses the full-width content layout after onboarding is complete', () => {
    render(
      <DashboardContentLayout
        onboarding={<div>Onboarding checklist</div>}
        showOnboarding={false}
      >
        <div>Brand information</div>
      </DashboardContentLayout>
    )

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })
})
