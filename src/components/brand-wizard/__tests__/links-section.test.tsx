// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import messages from '@/../messages/en.json'
import type { BrandWizardCommonValues } from '@/lib/schemas/brand-wizard'
import { BrandLinksSection } from '../links-section'

function Wrapper({ officialWebsiteRequired = true }) {
  const form = useForm<BrandWizardCommonValues>({
    defaultValues: { otherUrls: [] },
  })

  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <FormProvider {...form}>
        <BrandLinksSection
          officialWebsiteRequired={officialWebsiteRequired}
        />
      </FormProvider>
    </NextIntlClientProvider>
  )
}

describe('BrandLinksSection', () => {
  it('renders the three reference groups as the only card surfaces', () => {
    render(<Wrapper />)

    expect(screen.getByRole('group', { name: 'Social links' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Purchase Links' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Other links' })).toBeInTheDocument()
  })

  it('keeps each fixed platform identity and URL in one row', () => {
    render(<Wrapper />)

    const instagram = screen.getByLabelText('Instagram')
    expect(instagram.closest('[data-platform-row]')).toHaveTextContent('Instagram')
    expect(instagram.closest('[data-platform-row]')).toHaveClass('grid')
  })

  it('starts other links with one blank label and URL row', async () => {
    render(<Wrapper />)

    await waitFor(() => {
      expect(screen.getAllByLabelText('Label')).toHaveLength(1)
      expect(screen.getAllByLabelText('URL')).toHaveLength(1)
    })
  })

  it('marks official website required only when configured', () => {
    const { rerender } = render(<Wrapper />)
    expect(screen.getByLabelText('Official Website')).toHaveAttribute(
      'aria-required',
      'true',
    )

    rerender(<Wrapper officialWebsiteRequired={false} />)
    expect(screen.getByLabelText('Official Website')).toHaveAttribute(
      'aria-required',
      'false',
    )
  })
})
