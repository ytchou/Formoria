// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import zh from '../../../../messages/zh-TW.json'
import type { BrandChannel } from '@/lib/types'
import { BrandChannelsSection } from '../brand-channels-section'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (
    key: string,
    values?: Record<string, unknown>,
  ) => {
    const messages: Record<string, string> = {
      'sections.locationsAndRetailChannels': '地點與販售通路',
      'channels.subtitle': '以下為品牌可能的販售通路，部分資料為社群提供',
      'channels.provideInfo': '提供販售資訊',
      'channels.groups.official': '官方通路',
      'channels.groups.visitable': '可造訪門市',
      'channels.groups.chain': '連鎖與其他門市',
      'channels.groups.chainNote': '這些通路可能有多間門市或未提供地址，建議先致電確認庫存',
      'channels.groups.online': '線上通路',
      'channels.confirmed.storeInfoLink': '查看店家資訊',
      'channels.confirmed.officialPageLink': '前往官方頁面',
      'channels.unconfirmed.progress': '{count}/{threshold} 人確認',
      'channels.unconfirmed.thresholdNote':
        '虛線為尚待確認，累積 {threshold} 人確認後公開顯示',
      'channels.unconfirmed.foldSummary':
        '{count} 個社群提供的通路待確認',
      'channels.provenance.owner': '品牌確認',
      'channels.provenance.community': '社群確認',
      'channels.empty.title': '目前沒有販售通路資訊',
      'channels.empty.description':
        '如果您知道這個品牌的販售地點，歡迎提供資訊',
      'channels.empty.cta': '提供販售資訊',
      'channels.dialog.channelTypeOnline': '線上通路',
      'channels.dialog.channelTypeOffline': '實體通路',
      'channels.chips.showRest': '顯示其餘 {count} 家',
      'channels.chips.confirmAria': '我確認{name}有販售',
    }

    const message = messages[key] ?? key
    if (!values) return message

    return message.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in values ? String(values[name]) : match,
    )
  }),
}))

vi.mock('../provide-channel-info-dialog', () => ({
  ProvideChannelInfoDialog: () => (
    <button type='button'>提供販售資訊</button>
  ),
}))

// Thin stub: the grouped/chip/row rendering is the list component's contract and is
// covered in brand-channel-list.test.tsx. Here we only assert what the section forwards.
vi.mock('../brand-channel-list', () => ({
  BrandChannelList: ({
    confirmed,
    possible,
    threshold,
  }: {
    confirmed: BrandChannel[]
    possible: BrandChannel[]
    threshold: number
  }) => (
    <div data-testid='brand-channel-list' data-threshold={threshold}>
      {[...confirmed, ...possible].map((channel) => channel.name).join(', ')}
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
  it('uses the standard H2 treatment without a competing location icon', async () => {
    await renderSection()

    const heading = screen.getByRole('heading', { level: 2, name: '地點與販售通路' })
    expect(heading).toHaveClass('type-section-title-large')
    expect(heading.parentElement?.querySelector('svg')).toBeNull()
  })

  it('forwards every channel and the confirmation threshold to the list', async () => {
    await renderSection({
      confirmed: [
        makeChannel({
          id: 'owner-channel',
          name: '品牌門市',
          ownerStatus: 'confirmed',
          source: 'owner',
          status: 'confirmed',
          confirmedBy: 'owner',
        }),
      ],
      possible: [makeChannel({ id: 'possible-1', name: '可能通路一' })],
    })

    const list = screen.getByTestId('brand-channel-list')
    expect(list).toHaveTextContent('品牌門市, 可能通路一')
    expect(list).toHaveAttribute('data-threshold', '3')
  })

  it('replaces the subtitle with the threshold note when unconfirmed channels exist', async () => {
    const { unmount } = await renderSection({
      possible: [makeChannel({ id: 'possible-1', name: '可能通路一' })],
    })

    expect(
      screen.getByText('虛線為尚待確認，累積 3 人確認後公開顯示'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('以下為品牌可能的販售通路，部分資料為社群提供'),
    ).not.toBeInTheDocument()
    unmount()

    await renderSection({
      confirmed: [
        makeChannel({ id: 'confirmed-1', name: '已確認一', status: 'confirmed' }),
      ],
    })

    expect(
      screen.getByText('以下為品牌可能的販售通路，部分資料為社群提供'),
    ).toBeInTheDocument()
  })

  it('renders the list instead of the empty state once any channel exists', async () => {
    await renderSection({
      possible: [makeChannel({ id: 'possible-1', name: '可能通路一' })],
    })

    expect(screen.getByTestId('brand-channel-list')).toBeInTheDocument()
    expect(
      screen.queryByTestId('brand-channels-empty-state'),
    ).not.toBeInTheDocument()
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
      'groups.official',
      'groups.visitable',
      'groups.chain',
      'groups.chainNote',
      'groups.online',
      'confirmed.storeInfoLink',
      'confirmed.officialPageLink',
      'unconfirmed.confirmAction',
      'unconfirmed.confirmed',
      'unconfirmed.progress',
      'unconfirmed.thresholdNote',
      'unconfirmed.foldSummary',
      'unconfirmed.signInToConfirm',
      'chips.showRest',
      'chips.confirmAria',
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
