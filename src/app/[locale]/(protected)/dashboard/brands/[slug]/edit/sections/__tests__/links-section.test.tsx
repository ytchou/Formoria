// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import messages from '@/../messages/en.json'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { LinksSection } from '../links-section'

function Wrapper() {
  const form = useForm<BrandEditFormValues>()
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <LinksSection form={form} />
    </NextIntlClientProvider>
  )
}

describe('LinksSection', () => {
  it('renders at least one social link field', () => {
    render(<Wrapper />)
    const field = screen.queryByLabelText(/instagram/i) || screen.queryByText(/instagram/i)
    expect(field).toBeInTheDocument()
  })

  it('renders add link button for dynamic URLs', () => {
    render(<Wrapper />)
    const btn = screen.queryByRole('button', { name: /add/i })
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveClass('h-10', 'rounded-xl')
  })

  it('uses headings for each link group', () => {
    render(<Wrapper />)

    expect(screen.getByRole('heading', { name: 'Social links' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Purchase Links' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Other links' })).toBeInTheDocument()
  })

  it('places the required-field note below the section heading', () => {
    render(<Wrapper />)

    const heading = screen.getByRole('heading', { name: 'Social & purchase links' })
    const note = screen.getByText('indicates a required field')
    expect(
      heading.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
