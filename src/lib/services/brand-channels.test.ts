import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createServiceClient } from '@/lib/supabase/server'
import type {
  BrandChannelInput,
  ChannelCandidate,
} from '@/lib/types/brand-channel'
import {
  adminRemoveChannel,
  confirmChannel,
  findDuplicateCollisions,
  getChannelsForBrand,
  setOwnerChannelStatus,
  submitChannel,
  unconfirmChannel,
  upsertEnrichedChannels,
} from './brand-channels'

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  isOwnerOf: vi.fn(),
  logAdminAction: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mocks.createServiceClient,
}))

vi.mock('./brand-owners', () => ({
  isOwnerOf: mocks.isOwnerOf,
}))

vi.mock('./admin-audit', () => ({
  logAdminAction: mocks.logAdminAction,
}))

type DbError = {
  code?: string
  message?: string
}

type QueryResponse = {
  data: unknown
  error: DbError | null
  count?: number | null
}

type QueryBuilder = QueryResponse & {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  neq: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
  gte: ReturnType<typeof vi.fn>
  lt: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  then: Promise<QueryResponse>['then']
}

type DbChannelRow = {
  id: string
  brand_id: string
  name: string
  channel_type: string
  category_label: string | null
  region_label: string | null
  address: string | null
  url: string | null
  owner_status: string
  owner_status_by: string | null
  source: string
  removed_at: string | null
  brand_channel_confirmations: Array<{
    count?: number
    user_id?: string
  }>
}

function makeBuilder(response: QueryResponse): QueryBuilder {
  const builder = {
    ...response,
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    is: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    then: undefined,
  } as unknown as QueryBuilder

  builder.select.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.neq.mockReturnValue(builder)
  builder.is.mockReturnValue(builder)
  builder.gte.mockReturnValue(builder)
  builder.lt.mockReturnValue(builder)
  builder.insert.mockReturnValue(builder)
  builder.update.mockReturnValue(builder)
  builder.delete.mockReturnValue(builder)
  builder.upsert.mockReturnValue(builder)
  builder.maybeSingle.mockResolvedValue(response)
  builder.single.mockResolvedValue(response)
  builder.then = ((onfulfilled, onrejected) =>
    Promise.resolve(response).then(onfulfilled, onrejected)) as QueryBuilder['then']

  return builder
}

function mockSupabase(routes: Record<string, QueryBuilder[]>): ReturnType<typeof vi.fn> {
  const from = vi.fn((table: string) => {
    const builder = routes[table]?.shift()
    if (!builder) throw new Error(`Unexpected Supabase query for ${table}`)
    return builder
  })

  mocks.createServiceClient.mockReturnValue({
    from,
    rpc: mocks.rpc,
  } as unknown as ReturnType<typeof createServiceClient>)

  return from
}

function channelRow(overrides: Partial<DbChannelRow> = {}): DbChannelRow {
  return {
    id: 'channel-1',
    brand_id: 'brand-1',
    name: '登山友',
    channel_type: 'online',
    category_label: null,
    region_label: null,
    address: null,
    url: null,
    owner_status: 'none',
    owner_status_by: null,
    source: 'backfill',
    removed_at: null,
    brand_channel_confirmations: [{ count: 0 }],
    ...overrides,
  }
}

const submissionInput: BrandChannelInput = {
  name: 'Pinkoi',
  channelType: 'online',
  category: 'marketplace',
  region: 'Taiwan',
  address: '',
  url: 'https://www.pinkoi.com/',
}

describe('brand-channels service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createServiceClient.mockReset()
    mocks.isOwnerOf.mockReset()
    mocks.logAdminAction.mockReset()
    mocks.rpc.mockReset()
    mocks.logAdminAction.mockResolvedValue(undefined)
    mocks.rpc.mockResolvedValue({ data: null, error: null })
  })

  it('reads active channels with confirmation counts in one query', async () => {
    const query = makeBuilder({
      data: [
        channelRow({
          id: 'active-channel',
          brand_channel_confirmations: [{ count: 2 }],
        }),
        channelRow({
          id: 'tombstoned-channel',
          removed_at: '2026-07-24T01:00:00Z',
          brand_channel_confirmations: [{ count: 4 }],
        }),
      ],
      error: null,
    })
    const from = mockSupabase({ brand_channels: [query] })

    await expect(getChannelsForBrand('brand-1')).resolves.toEqual({
      confirmed: [],
      possible: [
        expect.objectContaining({
          id: 'active-channel',
          confirmationCount: 2,
          status: 'unconfirmed',
        }),
      ],
    })
    expect(from).toHaveBeenCalledTimes(1)
    expect(query.select).toHaveBeenCalledWith(
      expect.stringContaining('brand_channel_confirmations(count)'),
    )
    expect(query.eq).toHaveBeenCalledWith('brand_id', 'brand-1')
    expect(query.is).toHaveBeenCalledWith('removed_at', null)
    expect(query.neq).toHaveBeenCalledWith('owner_status', 'rejected')
  })

  it('confirms idempotently per user and returns the current count when unconfirmed', async () => {
    const firstUpsert = makeBuilder({ data: null, error: null })
    const firstCount = makeBuilder({ data: null, error: null, count: 1 })
    const secondUpsert = makeBuilder({ data: null, error: null })
    const secondCount = makeBuilder({ data: null, error: null, count: 1 })
    const deletion = makeBuilder({ data: null, error: null })
    const finalCount = makeBuilder({ data: null, error: null, count: 0 })
    mockSupabase({
      brand_channel_confirmations: [
        firstUpsert,
        firstCount,
        secondUpsert,
        secondCount,
        deletion,
        finalCount,
      ],
    })

    await expect(confirmChannel('user-1', 'channel-1')).resolves.toBe(1)
    await expect(confirmChannel('user-1', 'channel-1')).resolves.toBe(1)
    await expect(unconfirmChannel('user-1', 'channel-1')).resolves.toBe(0)

    expect(firstUpsert.upsert).toHaveBeenCalledWith(
      { channel_id: 'channel-1', user_id: 'user-1' },
      { onConflict: 'channel_id,user_id' },
    )
    expect(secondUpsert.upsert).toHaveBeenCalledWith(
      { channel_id: 'channel-1', user_id: 'user-1' },
      { onConflict: 'channel_id,user_id' },
    )
    expect(deletion.delete).toHaveBeenCalled()
  })

  it('submits a community channel and auto-confirms the submitter', async () => {
    const brandCap = makeBuilder({ data: null, error: null, count: 0 })
    const dailyCap = makeBuilder({ data: null, error: null, count: 0 })
    const insert = makeBuilder({
      data: { id: 'channel-1' },
      error: null,
    })
    const confirmation = makeBuilder({ data: null, error: null })
    const read = makeBuilder({
      data: [
        channelRow({
          id: 'channel-1',
          name: 'Pinkoi',
          source: 'community',
          brand_channel_confirmations: [{ count: 1 }],
        }),
      ],
      error: null,
    })
    mockSupabase({
      brand_channels: [brandCap, dailyCap, insert, read],
      brand_channel_confirmations: [confirmation],
    })

    await expect(submitChannel('user-1', 'brand-1', submissionInput)).resolves.toEqual({
      ok: true,
      id: 'channel-1',
    })
    expect(insert.insert).toHaveBeenCalledWith({
      brand_id: 'brand-1',
      name: 'Pinkoi',
      normalized_name: 'pinkoi',
      channel_type: 'online',
      category_label: 'marketplace',
      region_label: 'Taiwan',
      address: null,
      url: 'https://www.pinkoi.com/',
      source: 'community',
      created_by: 'user-1',
    })
    expect(confirmation.upsert).toHaveBeenCalledWith(
      { channel_id: 'channel-1', user_id: 'user-1' },
      { onConflict: 'channel_id,user_id' },
    )
    await expect(getChannelsForBrand('brand-1')).resolves.toMatchObject({
      possible: [expect.objectContaining({ id: 'channel-1', confirmationCount: 1 })],
    })
  })

  it('enforces the per-brand and rolling daily submission caps with typed errors', async () => {
    const brandAtCap = makeBuilder({ data: null, error: null, count: 5 })
    const brandBelowCap = makeBuilder({ data: null, error: null, count: 0 })
    const dailyAtCap = makeBuilder({ data: null, error: null, count: 20 })
    mockSupabase({
      brand_channels: [brandAtCap, brandBelowCap, dailyAtCap],
    })

    await expect(submitChannel('user-1', 'brand-1', submissionInput)).resolves.toEqual({
      ok: false,
      code: 'active_cap_reached',
    })
    await expect(submitChannel('user-1', 'brand-1', submissionInput)).resolves.toEqual({
      ok: false,
      code: 'daily_cap_reached',
    })
  })

  it('returns duplicate_name for normalized-name collisions, including tombstones', async () => {
    const duplicate = { code: '23505', message: 'brand_channels_brand_id_normalized_name_key' }
    const builders = [
      makeBuilder({ data: null, error: null, count: 0 }),
      makeBuilder({ data: null, error: null, count: 0 }),
      makeBuilder({ data: null, error: duplicate }),
      makeBuilder({ data: null, error: null, count: 0 }),
      makeBuilder({ data: null, error: null, count: 0 }),
      makeBuilder({ data: null, error: duplicate }),
    ]
    mockSupabase({ brand_channels: builders })

    await expect(
      submitChannel('user-1', 'brand-1', { ...submissionInput, name: '登山友 店' }),
    ).resolves.toEqual({ ok: false, code: 'duplicate_name' })
    await expect(
      submitChannel('user-1', 'brand-1', { ...submissionInput, name: '登山友' }),
    ).resolves.toEqual({ ok: false, code: 'duplicate_name' })
  })

  it('requires ownership before setting confirmed or rejected owner status', async () => {
    const nonOwnerLookup = makeBuilder({
      data: { brand_id: 'brand-1' },
      error: null,
    })
    const ownerLookup = makeBuilder({
      data: { brand_id: 'brand-1' },
      error: null,
    })
    const confirmedUpdate = makeBuilder({ data: { id: 'channel-1' }, error: null })
    const rejectedLookup = makeBuilder({
      data: { brand_id: 'brand-1' },
      error: null,
    })
    const rejectedUpdate = makeBuilder({ data: { id: 'channel-1' }, error: null })
    mockSupabase({
      brand_channels: [
        nonOwnerLookup,
        ownerLookup,
        confirmedUpdate,
        rejectedLookup,
        rejectedUpdate,
      ],
    })
    mocks.isOwnerOf
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    await expect(
      setOwnerChannelStatus('user-1', 'channel-1', 'confirmed'),
    ).resolves.toEqual({ ok: false, code: 'not_owner' })
    await expect(
      setOwnerChannelStatus('owner-1', 'channel-1', 'confirmed'),
    ).resolves.toEqual({ ok: true })
    await expect(
      setOwnerChannelStatus('owner-1', 'channel-1', 'rejected'),
    ).resolves.toEqual({ ok: true })

    expect(confirmedUpdate.update).toHaveBeenCalledWith({
      owner_status: 'confirmed',
      owner_status_by: 'owner-1',
    })
    expect(rejectedUpdate.update).toHaveBeenCalledWith({
      owner_status: 'rejected',
      owner_status_by: 'owner-1',
    })
  })

  it('tombstones removed channels and writes an admin audit entry', async () => {
    const removal = makeBuilder({
      data: { brand_id: 'brand-1' },
      error: null,
    })
    const read = makeBuilder({
      data: [channelRow({ removed_at: '2026-07-24T02:00:00Z' })],
      error: null,
    })
    mockSupabase({ brand_channels: [removal, read] })

    await expect(
      adminRemoveChannel('channel-1', 'admin-1', 'admin@example.com'),
    ).resolves.toEqual({ ok: true })
    expect(removal.update).toHaveBeenCalledWith({
      removed_at: expect.any(String),
      removed_by: 'admin-1',
    })
    expect(mocks.logAdminAction).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      adminEmail: 'admin@example.com',
      action: 'channel_removed',
      targetBrandId: 'brand-1',
      metadata: { channelId: 'channel-1' },
    })
    await expect(getChannelsForBrand('brand-1')).resolves.toEqual({
      confirmed: [],
      possible: [],
    })
  })

  it('uses conditional enrichment to fill gaps without touching protected fields', async () => {
    const candidates: ChannelCandidate[] = [
      {
        name: 'Existing URL 店',
        normalizedName: 'ignored',
        channelType: 'online',
        categoryLabel: null,
        regionLabel: null,
        address: 'New address',
        url: 'https://should-not-overwrite.example',
      },
      {
        name: 'Rejected Channel',
        normalizedName: 'ignored-too',
        channelType: 'offline',
        address: 'Ignored address',
        url: null,
      },
    ]
    mocks.rpc.mockResolvedValue({ data: 2, error: null })
    mockSupabase({})

    await expect(upsertEnrichedChannels('brand-1', candidates)).resolves.toEqual({
      ok: true,
      count: 2,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('upsert_enriched_brand_channels', {
      p_brand_id: 'brand-1',
      p_candidates: [
        {
          name: 'Existing URL 店',
          normalized_name: 'existingurl',
          channel_type: 'online',
          category_label: null,
          region_label: null,
          address: 'New address',
          url: 'https://should-not-overwrite.example',
          source: 'enriched',
        },
        {
          name: 'Rejected Channel',
          normalized_name: 'rejectedchannel',
          channel_type: 'offline',
          category_label: null,
          region_label: null,
          address: 'Ignored address',
          url: null,
          source: 'enriched',
        },
      ],
    })
  })

  it('flags active channels whose noise-stripped names collide', async () => {
    const query = makeBuilder({
      data: [
        channelRow({ id: 'channel-1', name: '登山友 店' }),
        channelRow({ id: 'channel-2', name: '登山友' }),
        channelRow({ id: 'channel-3', name: '登山王' }),
        channelRow({
          id: 'removed-channel',
          name: '登山友 門市',
          removed_at: '2026-07-24T03:00:00Z',
        }),
        channelRow({ id: 'rejected-channel', name: '登山友 旗艦店', owner_status: 'rejected' }),
      ],
      error: null,
    })
    mockSupabase({ brand_channels: [query] })

    await expect(findDuplicateCollisions('brand-1')).resolves.toEqual([
      {
        normalizedName: '登山友',
        channelIds: ['channel-1', 'channel-2'],
      },
    ])
    expect(query.is).toHaveBeenCalledWith('removed_at', null)
    expect(query.neq).toHaveBeenCalledWith('owner_status', 'rejected')
  })
})
