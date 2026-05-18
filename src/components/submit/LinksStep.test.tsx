// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { LinksStep } from './LinksStep'

function Wrapper({ children }: { children: React.ReactNode }) {
  const methods = useForm({
    defaultValues: {
      purchaseLinks: [{ platform: '', url: '' }],
      socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
      retailLocations: [] as { name: string; address: string }[],
    },
  })
  return <FormProvider {...methods}>{children}</FormProvider>
}

describe('LinksStep', () => {
  it('renders purchase links section with one default row', () => {
    render(
      <Wrapper>
        <LinksStep />
      </Wrapper>
    )
    expect(screen.getByText(/purchase links/i)).toBeInTheDocument()
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(1)
  })

  it('renders social link fields', () => {
    render(
      <Wrapper>
        <LinksStep />
      </Wrapper>
    )
    expect(screen.getByLabelText(/instagram/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/threads/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/facebook/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/website/i)).toBeInTheDocument()
  })

  it('allows adding another purchase link row', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper>
        <LinksStep />
      </Wrapper>
    )
    await user.click(screen.getByText(/add another link/i))
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2)
  })

  it('renders retail locations section', () => {
    render(
      <Wrapper>
        <LinksStep />
      </Wrapper>
    )
    expect(screen.getByText(/retail locations/i)).toBeInTheDocument()
    expect(screen.getByText(/add location/i)).toBeInTheDocument()
  })
})
