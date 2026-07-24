// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import zh from '../../../../messages/zh-TW.json'
import type { BrandChannel } from '@/lib/types'
import { BrandChannelsSection } from '../brand-channels-section'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => {
    const messages: Record<string, string> = {
      'sections.locationsAndRetailChannels': '地點與販售通路',
      'channels.subtitle': '以下為品牌可能的販售通路，部分資料為社群提供',
      'channels.provideInfo': '提供販售資訊',
      'channels.confirmed.heading': '品牌已確認販售',
      'channels.confirmed.explainer': '以下通路經品牌方或社群確認為正確',
      'channels.confirmed.storeInfoLink': '查看店家資訊',
      'channels.confirmed.officialPageLink': '前往官方頁面',
      'channels.unconfirmed.heading': '可能販售（尚待確認）',
      'channels.unconfirmed.explainer':
        '以下資訊來自社群提供或自動蒐集，尚未經品牌方確認',
      'channels.provenance.owner': '品牌確認',
      'channels.provenance.community': '社群確認',
      'channels.empty.title': '目前沒有販售通路資訊',
      'channels.empty.description':
        '如果您知道這個品牌的販售地點，歡迎提供資訊',
      'channels.empty.cta': '提供販售資訊',
      'channels.dialog.channelTypeOnline': '線上通路',
      'channels.dialog.channelTypeOffline': '實體通路',
    }

    return messages[key] ?? key
  }),
}))

vi.mock('../provide-channel-info-dialog', () => ({
  ProvideChannelInfoDialog: () => (
    <button type='button'>提供販售資訊</button>
  ),
}))

vi.mock('../unconfirmed-channel-grid', () => ({
  UnconfirmedChannelGrid: ({ channels }: { channels: BrandChannel[] }) => (
    <div data-testid='unconfirmed-channel-grid'>
      {channels.map((channel) => channel.name).join(', ')}
    </div>
  ),
}))

function makeChannel(overrides: Partial<BrandChannel> = {}): BrandChannel {
  return {
    id: 'channel-1',
    name: '測試通路',
    channelType: 'offline',
    categoryLabel: '選品店',
    regionLabel: '台北市',
    address: null,
    url: null,
    ownerStatus: 'none',
    source: 'community',
    confirmationCount: 0,
    status: 'unconfirmed',
    ...overrides,
  }
}

async function renderSection(
  overrides: Partial<Parameters<typeof BrandChannelsSection>[0]> = {},
) {
  return render(
    await BrandChannelsSection({
      confirmed: [],
      possible: [],
      brandId: 'brand-1',
      brandSlug: 'test-brand',
      ...overrides,
    }),
  )
}

describe('BrandChannelsSection', () => {
  it('renders confirmed rows with provenance badges and external links', async () => {
    await renderSection({
      confirmed: [
        makeChannel({
          id: 'owner-channel',
          name: '品牌門市',
          ownerStatus: 'confirmed',
          status: 'confirmed',
          confirmedBy: 'owner',
          url: 'https://brand.example/store',
        }),
        makeChannel({
          id: 'community-channel',
          name: '社群選物店',
          status: 'confirmed',
          confirmedBy: 'community',
        }),
      ],
    })

    expect(
      screen.getByRole('heading', { name: '品牌已確認販售 (2)' }),
    ).toBeInTheDocument()
    expect(screen.getByText('品牌確認')).toBeInTheDocument()
    expect(screen.getByText('社群確認')).toBeInTheDocument()

    const externalLink = screen.getByRole('link', { name: '查看店家資訊' })
    expect(externalLink).toHaveAttribute(
      'href',
      'https://brand.example/store',
    )
    expect(externalLink).toHaveAttribute('target', '_blank')
    expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders google maps link when address present', async () => {
    const address = '台北市信義區市府路 1 號'
    const { container } = await renderSection({
      confirmed: [
        makeChannel({
          id: 'addressed-channel',
          name: '有地址通路',
          address,
        }),
        makeChannel({
          id: 'region-only-channel',
          name: '只有地區通路',
          regionLabel: '台中市',
        }),
      ],
    })

    const mapsLink = screen.getByRole('link', { name: '台北市' })
    expect(mapsLink).toHaveAttribute(
      'href',
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    )

    const regionOnlyText = screen.getByText('台中市')
    expect(regionOnlyText.closest('a')).toBeNull()
    expect(
      container.querySelectorAll('a[href^="https://www.google.com/maps/search/"]'),
    ).toHaveLength(1)
  })

  it('renders online channels with monitor icon and 線上通路', async () => {
    const { container } = await renderSection({
      confirmed: [
        makeChannel({
          channelType: 'online',
          name: '品牌官網',
          status: 'confirmed',
          confirmedBy: 'owner',
        }),
      ],
    })

    expect(screen.getByText('線上通路')).toBeInTheDocument()
    expect(container.querySelector('[data-channel-icon="monitor"]')).toBeInTheDocument()
  })

  it('omits empty groups and renders counts in headings', async () => {
    const { container } = await renderSection({
      possible: [
        makeChannel({ id: 'possible-1', name: '可能通路一' }),
        makeChannel({ id: 'possible-2', name: '可能通路二' }),
      ],
    })

    expect(
      screen.queryByRole('heading', { name: /品牌已確認販售/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '可能販售（尚待確認） (2)' }),
    ).toBeInTheDocument()
    expect(container.querySelector('[data-channel-group="confirmed"]')).toBeNull()

    const confirmedRender = await renderSection({
      confirmed: [
        makeChannel({ id: 'confirmed-1', name: '已確認一', status: 'confirmed' }),
        makeChannel({ id: 'confirmed-2', name: '已確認二', status: 'confirmed' }),
      ],
    })
    const confirmedGroup = confirmedRender.container.querySelector(
      '[data-channel-group="confirmed"]',
    )
    expect(confirmedGroup).not.toBeNull()
    expect(
      within(confirmedGroup as HTMLElement).getByRole('heading', {
        name: '品牌已確認販售 (2)',
      }),
    ).toBeInTheDocument()
    expect(confirmedGroup?.querySelectorAll('[data-channel-row]')).toHaveLength(2)
  })

  it('renders empty state with provide-info CTA when no channels', async () => {
    await renderSection()

    expect(screen.getByText('目前沒有販售通路資訊')).toBeInTheDocument()
    const emptyState = screen.getByTestId('brand-channels-empty-state')
    expect(
      within(emptyState).getByRole('button', { name: '提供販售資訊' }),
    ).toBeInTheDocument()
  })

  it('i18n: all new keys present in both locales', () => {
    const requiredKeys = [
      'subtitle',
      'provideInfo',
      'confirmed.heading',
      'confirmed.explainer',
      'confirmed.storeInfoLink',
      'confirmed.officialPageLink',
      'unconfirmed.heading',
      'unconfirmed.explainer',
      'unconfirmed.whatIsThis',
      'unconfirmed.whatIsThisAnswer',
      'unconfirmed.confirmAction',
      'unconfirmed.confirmedCount',
      'unconfirmed.confirmed',
      'unconfirmed.signInToConfirm',
      'unconfirmed.showAll',
      'unconfirmed.showLess',
      'provenance.owner',
      'provenance.community',
      'ownerBanner.title',
      'ownerBanner.description',
      'empty.title',
      'empty.description',
      'empty.cta',
      'dialog.title',
      'dialog.nameLabel',
      'dialog.namePlaceholder',
      'dialog.channelTypeLabel',
      'dialog.channelTypeOnline',
      'dialog.channelTypeOffline',
      'dialog.categoryLabel',
      'dialog.categoryPlaceholder',
      'dialog.categoryBrandStore',
      'dialog.categoryDepartment',
      'dialog.categoryStockist',
      'dialog.categoryOther',
      'dialog.regionLabel',
      'dialog.regionPlaceholder',
      'dialog.addressLabel',
      'dialog.addressPlaceholder',
      'dialog.urlLabel',
      'dialog.urlPlaceholder',
      'dialog.submit',
      'dialog.success',
      'dialog.signInRequired',
      'errors.not_logged_in',
      'errors.missing_brand_id',
      'errors.missing_brand_slug',
      'errors.invalid_name',
      'errors.invalid_channel_type',
      'errors.invalid_url',
      'errors.active_cap_reached',
      'errors.daily_cap_reached',
      'errors.duplicate_name',
      'errors.database_error',
      'errors.unknown',
      'countLabel',
    ]

    function readPath(value: unknown, path: string): unknown {
      return path.split('.').reduce<unknown>((current, segment) => {
        if (typeof current !== 'object' || current === null) return undefined
        return (current as Record<string, unknown>)[segment]
      }, value)
    }

    for (const locale of [zh, en]) {
      for (const key of requiredKeys) {
        expect(readPath(locale.brandDetail.channels, key)).toEqual(
          expect.any(String),
        )
      }
    }

    function keyShape(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(keyShape)
      if (typeof value !== 'object' || value === null) return typeof value

      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [key, keyShape((value as Record<string, unknown>)[key])]),
      )
    }

    expect(keyShape(zh.brandDetail.channels)).toEqual(
      keyShape(en.brandDetail.channels),
    )
  })
})
