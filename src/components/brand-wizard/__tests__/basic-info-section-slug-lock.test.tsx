// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'
import { BrandBasicInfoSection } from '../basic-info-section'

vi.mock('next-intl', () => ({
  useTranslations: () =>
    Object.assign((key: string) => key, {
      has: () => true,
    }),
}))

function Wrapper({ currentSlug }: { currentSlug?: string }) {
  const form = useForm({
    defaultValues: { romanizedName: 'test-brand', name: 'Test' },
  })
  return (
    <FormProvider {...form}>
      <BrandBasicInfoSection currentSlug={currentSlug} />
    </FormProvider>
  )
}

describe('BrandBasicInfoSection slug lock', () => {
  it('renders romanizedName as read-only when currentSlug is provided', () => {
    render(<Wrapper currentSlug="test-brand" />)
    const input = screen.getByRole('textbox', { name: /romanized/i })
    expect(input).toHaveAttribute('readOnly')
  })

  it('shows explanation text when slug is locked', () => {
    render(<Wrapper currentSlug="test-brand" />)
    expect(screen.getByText(/slugChangeBlocked/i)).toBeInTheDocument()
  })

  it('allows romanizedName editing when currentSlug is not provided', () => {
    render(<Wrapper />)
    const input = screen.getByRole('textbox', { name: /romanized/i })
    expect(input).not.toHaveAttribute('readOnly')
  })
})
