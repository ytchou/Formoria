// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../messages/zh-TW.json'
import { LinksStep } from './LinksStep'

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
      retailLocations: [] as { name: string; address: string }[],
    },
  })
  return <FormProvider {...methods}>{children}</FormProvider>
}

describe('LinksStep', () => {
  it('renders retail locations section with add button', () => {
    renderWithZhTW(
      <Wrapper>
        <LinksStep />
      </Wrapper>
    )
    // retailLocations = "實體零售地點", addLocation = "新增地點"
    expect(screen.getByText('實體零售地點')).toBeInTheDocument()
    expect(screen.getByText('新增地點')).toBeInTheDocument()
  })

  it('adds a location row when clicking the add button', async () => {
    const user = userEvent.setup()
    renderWithZhTW(
      <Wrapper>
        <LinksStep />
      </Wrapper>
    )

    // No inputs initially (empty retailLocations)
    expect(screen.queryAllByPlaceholderText('店名').length).toBe(0)

    await user.click(screen.getByText('新增地點'))

    // One row with store name and address inputs
    expect(screen.getAllByPlaceholderText('店名').length).toBe(1)
    expect(screen.getAllByPlaceholderText('地址').length).toBe(1)
  })

  it('shows remove button when a location exists', async () => {
    const user = userEvent.setup()
    renderWithZhTW(
      <Wrapper>
        <LinksStep />
      </Wrapper>
    )

    await user.click(screen.getByText('新增地點'))

    expect(screen.getByRole('button', { name: /remove location 1/i })).toBeInTheDocument()
  })

  it('removes a location row when the remove button is clicked', async () => {
    const user = userEvent.setup()
    renderWithZhTW(
      <Wrapper>
        <LinksStep />
      </Wrapper>
    )

    await user.click(screen.getByText('新增地點'))
    expect(screen.getAllByPlaceholderText('店名').length).toBe(1)

    await user.click(screen.getByRole('button', { name: /remove location 1/i }))
    expect(screen.queryAllByPlaceholderText('店名').length).toBe(0)
  })
})
