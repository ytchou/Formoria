// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../messages/zh-TW.json'
import { LinksStep } from './LinksStep'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

function renderWithZhTW(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

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

    renderWithZhTW(
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
    renderWithZhTW(
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
    renderWithZhTW(
      <Wrapper>
        <LinksStep />
      </Wrapper>
    )
    // isOwner defaults to false → purchaseLinksOptional = "購買連結（可選）"
    expect(screen.getByText('購買連結（可選）')).toBeInTheDocument()
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(1)
  })

  it('renders social link fields', () => {
    renderWithZhTW(
      <Wrapper>
        <LinksStep />
      </Wrapper>
    )
    // Social link labels are hardcoded strings in the component
    expect(screen.getByLabelText(/instagram/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/threads/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/facebook/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/website/i)).toBeInTheDocument()
  })

  it('allows adding another purchase link row', async () => {
    const user = userEvent.setup()
    renderWithZhTW(
      <Wrapper>
        <LinksStep />
      </Wrapper>
    )
    // addAnotherLink = "新增另一個連結"
    await user.click(screen.getByText('新增另一個連結'))
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2)
  })

  it('renders retail locations section', () => {
    renderWithZhTW(
      <Wrapper>
        <LinksStep />
      </Wrapper>
    )
    // retailLocations = "實體零售地點", addLocation = "新增地點"
    expect(screen.getByText('實體零售地點')).toBeInTheDocument()
    expect(screen.getByText('新增地點')).toBeInTheDocument()
  })
})
