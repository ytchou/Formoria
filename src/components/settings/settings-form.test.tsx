// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import messages from '../../../messages/zh-TW.json'

vi.mock('@/app/[locale]/(protected)/settings/actions', () => ({
  updateSettings: vi.fn(),
}))

import { SettingsForm } from './settings-form'

describe('SettingsForm marketing preferences', () => {
  it('renders independent category controls and all-off action', () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={messages}>
        <SettingsForm
          profile={{ displayName: null, localePreference: 'zh-TW' }}
          email="owner@example.com"
          currentLocale="zh-TW"
          newsletterStatus="pending"
          lifecycleOptedIn={false}
        />
      </NextIntlClientProvider>,
    )

    expect(screen.getByRole('checkbox', {
      name: 'Formoria 電子報',
    })).toBeChecked()
    expect(screen.getByText(/確認信已寄出/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', {
      name: '品牌經營提醒與功能建議',
    })).not.toBeChecked()
    expect(screen.getByRole('button', {
      name: '取消所有行銷電子郵件',
    })).toBeInTheDocument()
  })
})
