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

function WrapperWithDefaults({
  children,
  socialDefaults,
}: {
  children: React.ReactNode
  socialDefaults?: {
    instagram?: string
    threads?: string
    facebook?: string
    website?: string
  }
}) {
  const methods = useForm({
    defaultValues: {
      purchaseLinks: [{ platform: '', url: '' }],
      socialLinks: {
        instagram: socialDefaults?.instagram ?? '',
        threads: socialDefaults?.threads ?? '',
        facebook: socialDefaults?.facebook ?? '',
        website: socialDefaults?.website ?? '',
      },
      retailLocations: [] as { name: string; address: string }[],
    },
  })
  return <FormProvider {...methods}>{children}</FormProvider>
}

describe('LinksStep pre-fill', () => {
  it('pre-fills social link fields from scraped data', () => {
    const defaultValues = {
      instagram: 'https://instagram.com/mybrand',
      threads: 'https://threads.net/@mybrand',
      facebook: 'https://facebook.com/mybrand',
      website: 'https://mybrand.com.tw',
    }

    render(
      <WrapperWithDefaults socialDefaults={defaultValues}>
        <LinksStep />
      </WrapperWithDefaults>
    )

    expect(
      screen.getByDisplayValue('https://instagram.com/mybrand')
    ).toBeInTheDocument()
    expect(
      screen.getByDisplayValue('https://threads.net/@mybrand')
    ).toBeInTheDocument()
    expect(
      screen.getByDisplayValue('https://facebook.com/mybrand')
    ).toBeInTheDocument()
    expect(
      screen.getByDisplayValue('https://mybrand.com.tw')
    ).toBeInTheDocument()
  })

  it('renders empty fields when no default values', () => {
    render(
      <Wrapper>
        <LinksStep />
      </Wrapper>
    )

    const socialInputs = [
      screen.getByLabelText(/instagram/i),
      screen.getByLabelText(/threads/i),
      screen.getByLabelText(/facebook/i),
      screen.getByLabelText(/website/i),
    ]
    socialInputs.forEach((input) => {
      expect(input).toHaveValue('')
    })
  })
})

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
