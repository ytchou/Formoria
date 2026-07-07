// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'
import messages from '@/../messages/en.json'
import { ProfileCompletenessCard } from './profile-completeness-card'

describe('ProfileCompletenessCard', () => {
  it('starts expanded and allows recommendations to be collapsed', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ProfileCompletenessCard
          slug="test-brand"
          completeness={{
            score: 50,
            completed: 6,
            total: 12,
            components: [],
            recommendations: [
              {
                key: 'description',
                complete: false,
                required: true,
                weight: 5,
                step: 0,
              },
            ],
          }}
        />
      </NextIntlClientProvider>,
    )

    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '50%' })).toBeInTheDocument()
    expect(screen.getByText('6 of 12 components complete')).toBeInTheDocument()
    expect(screen.getByText('Add your brand story')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/en/dashboard/brands/test-brand/edit?step=0',
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Add your brand story')).not.toBeInTheDocument()
  })
})
