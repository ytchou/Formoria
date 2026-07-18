import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { buildNewsletterConfirmEmail } from '@emails/templates/newsletter-confirm'
import { sendEmail } from '@/lib/email/send'

export const VALID_INTERESTS = [
  'brand-stories',
  'new-brands',
  'curated-picks',
  'mit-trends',
] as const

export type NewsletterInterest = (typeof VALID_INTERESTS)[number]

export type NewsletterSubscriber = {
  id: string
  email: string
  name: string | null
  interests: string[] | null
  locale: string
  subscribed_at: string
  confirmed_at: string | null
  confirm_token: string
  unsubscribe_token: string
  unsubscribed_at: string | null
  consent_source: string | null
  consent_version: string | null
  consent_recorded_at: string | null
  created_at: string
}

type NewsletterSubscriberInsert = {
  email: string
  name?: string | null
  interests: NewsletterInterest[]
  locale?: string
  confirmed_at: null
  consent_source: string
  consent_version: string
  consent_recorded_at: string
}

type NewsletterSubscriberUpdate = Partial<{
  name: string | null
  interests: NewsletterInterest[]
  locale: string
  confirmed_at: string | null
  confirm_token: string
  unsubscribe_token: string
  unsubscribed_at: string | null
  subscribed_at: string
  consent_source: string
  consent_version: string
  consent_recorded_at: string
}>

type NewsletterError = {
  code?: string
  message?: string
}

type NewsletterResult<T> = Promise<{
  data: T | null
  error: NewsletterError | null
  count?: number | null
}>

type NewsletterEqBuilder<T> = PromiseLike<{
  data: T | null
  error: NewsletterError | null
  count?: number | null
}> & {
  eq(column: string, value: string): NewsletterEqBuilder<T>
  not(column: string, operator: string, value: string | null): NewsletterEqBuilder<T>
  is(column: string, value: null): NewsletterEqBuilder<T>
  order(column: string, options?: { ascending?: boolean }): NewsletterRangeBuilder<T>
  maybeSingle(): NewsletterResult<T>
  single(): NewsletterResult<T>
}

type NewsletterRangeBuilder<T> = {
  range(from: number, to: number): NewsletterResult<T[]>
}

type NewsletterTable = {
  insert(values: NewsletterSubscriberInsert): {
    select(columns?: string): {
      single(): NewsletterResult<NewsletterSubscriber>
    }
  }
  select(
    columns?: string,
    options?: { count?: 'exact'; head?: boolean }
  ): NewsletterEqBuilder<NewsletterSubscriber>
  update(values: NewsletterSubscriberUpdate): {
    eq(column: string, value: string): {
      select(columns?: string): {
        single(): NewsletterResult<NewsletterSubscriber>
      }
    } & NewsletterResult<unknown>
  }
}

type NewsletterClient = {
  from(table: 'newsletter_subscribers'): NewsletterTable
}

export type CreateSubscriberInput = {
  email: string
  name?: string
  interests?: string[]
  locale?: string
  consentSource: string
  consentVersion: string
}

export type CreateSubscriberResult = {
  subscriber: NewsletterSubscriber
  isNew: boolean
  needsConfirmation: boolean
}

export type SubscriberActionResult =
  | { success: true; subscriber: NewsletterSubscriber }
  | { success: false; error: string }

export type GetSubscribersOptions = {
  page?: number
  limit?: number
}

export type SubscriberStats = {
  total: number
  active: number
  pending: number
  unsubscribed: number
  confirmationRate: number
}

export type NewsletterSubscriberStatus = 'active' | 'pending' | 'unsubscribed'

export type AdminNewsletterSubscriber = Pick<
  NewsletterSubscriber,
  | 'id'
  | 'email'
  | 'name'
  | 'interests'
  | 'locale'
  | 'subscribed_at'
  | 'confirmed_at'
  | 'unsubscribed_at'
  | 'consent_source'
  | 'consent_version'
  | 'consent_recorded_at'
> & { status: NewsletterSubscriberStatus }

export type AdminNewsletterFilters = {
  q?: string
  status?: NewsletterSubscriberStatus
  interest?: NewsletterInterest
  cursor?: string
  direction?: 'next' | 'previous'
  limit?: number
}

export type AdminNewsletterPage = {
  subscribers: AdminNewsletterSubscriber[]
  nextCursor: string | null
  previousCursor: string | null
}

export type NewsletterPreference = {
  status: 'off' | 'pending' | 'on'
  subscriber: NewsletterSubscriber | null
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function newsletterTable(supabase: SupabaseClient): NewsletterTable {
  return (supabase as unknown as NewsletterClient).from('newsletter_subscribers')
}

function newToken(): string {
  return crypto.randomUUID()
}

function assertNoError(error: NewsletterError | null): void {
  if (error) {
    throw new Error(error.message ?? 'Newsletter database operation failed')
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function validateEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email)
}

export function normalizeInterests(interests: string[]): NewsletterInterest[] {
  const validInterests = new Set<string>(VALID_INTERESTS)
  const normalized: NewsletterInterest[] = []

  for (const interest of interests) {
    if (validInterests.has(interest) && !normalized.includes(interest as NewsletterInterest)) {
      normalized.push(interest as NewsletterInterest)
    }
  }

  return normalized
}

export function deriveNewsletterStatus(
  subscriber: Pick<NewsletterSubscriber, 'confirmed_at' | 'unsubscribed_at'>,
): NewsletterSubscriberStatus {
  if (subscriber.unsubscribed_at) return 'unsubscribed'
  return subscriber.confirmed_at ? 'active' : 'pending'
}

export function calculateConfirmationRate({
  active,
  pending,
}: Pick<SubscriberStats, 'active' | 'pending'>): number {
  const eligible = active + pending
  return eligible === 0 ? 0 : Math.round((active / eligible) * 100)
}

export async function createSubscriber(
  supabase: SupabaseClient,
  {
    email,
    name,
    interests,
    locale,
    consentSource,
    consentVersion,
  }: CreateSubscriberInput
): Promise<CreateSubscriberResult> {
  const normalizedEmail = normalizeEmail(email)

  if (!validateEmail(normalizedEmail)) {
    throw new Error('Invalid email')
  }

  const table = newsletterTable(supabase)
  const { data: existingSubscriber, error: lookupError } = await table
    .select('*')
    .eq('email', normalizedEmail)
    .maybeSingle()

  assertNoError(lookupError)

  const normalizedInterests = interests === undefined
    ? normalizeInterests(existingSubscriber?.interests ?? ['curated-picks'])
    : normalizeInterests(interests)
  const consentRecordedAt = new Date().toISOString()

  if (existingSubscriber) {
    if (existingSubscriber.unsubscribed_at !== null) {
      const { data, error } = await table
        .update({
          name: name ?? existingSubscriber.name,
          interests: normalizedInterests,
          locale: locale ?? existingSubscriber.locale ?? 'zh-TW',
          confirmed_at: null,
          confirm_token: newToken(),
          unsubscribe_token: newToken(),
          unsubscribed_at: null,
          subscribed_at: new Date().toISOString(),
          consent_source: consentSource,
          consent_version: consentVersion,
          consent_recorded_at: consentRecordedAt,
        })
        .eq('email', normalizedEmail)
        .select()
        .single()

      assertNoError(error)

      return {
        subscriber: data as NewsletterSubscriber,
        isNew: false,
        needsConfirmation: true,
      }
    }

    if (existingSubscriber.confirmed_at !== null) {
      const { data, error } = await table
        .update({
          name: name ?? existingSubscriber.name,
          interests: normalizedInterests,
          locale: locale ?? existingSubscriber.locale ?? 'zh-TW',
          consent_source: consentSource,
          consent_version: consentVersion,
          consent_recorded_at: consentRecordedAt,
        })
        .eq('email', normalizedEmail)
        .select()
        .single()

      assertNoError(error)

      return {
        subscriber: data as NewsletterSubscriber,
        isNew: false,
        needsConfirmation: false,
      }
    }

    const { data, error } = await table
      .update({
        name: name ?? existingSubscriber.name,
        interests: normalizedInterests,
        locale: locale ?? existingSubscriber.locale ?? 'zh-TW',
        confirm_token: newToken(),
        unsubscribe_token: newToken(),
        consent_source: consentSource,
        consent_version: consentVersion,
        consent_recorded_at: consentRecordedAt,
      })
      .eq('email', normalizedEmail)
      .select()
      .single()

    assertNoError(error)

    return {
      subscriber: data as NewsletterSubscriber,
      isNew: false,
      needsConfirmation: true,
    }
  }

  const { data, error } = await table
    .insert({
      email: normalizedEmail,
      name: name ?? null,
      interests: normalizedInterests,
      locale: locale ?? 'zh-TW',
      confirmed_at: null,
      consent_source: consentSource,
      consent_version: consentVersion,
      consent_recorded_at: consentRecordedAt,
    })
    .select()
    .single()

  assertNoError(error)

  return {
    subscriber: data as NewsletterSubscriber,
    isNew: true,
    needsConfirmation: true,
  }
}

export async function confirmSubscriber(
  supabase: SupabaseClient,
  confirmToken: string
): Promise<SubscriberActionResult> {
  const table = newsletterTable(supabase)
  const { data: existingSubscriber, error: lookupError } = await table
    .select('*')
    .eq('confirm_token', confirmToken)
    .maybeSingle()

  if (lookupError || existingSubscriber === null) {
    return { success: false, error: 'Token not found' }
  }

  if (existingSubscriber.unsubscribed_at) {
    return { success: false, error: 'Token not found' }
  }

  if (existingSubscriber.confirmed_at) {
    return { success: true, subscriber: existingSubscriber as NewsletterSubscriber }
  }

  const { data, error } = await table
    .update({
      confirmed_at: new Date().toISOString(),
    })
    .eq('confirm_token', confirmToken)
    .select()
    .single()

  if (error || data === null) {
    return { success: false, error: error?.message ?? 'Unable to confirm subscriber' }
  }

  return { success: true, subscriber: data }
}

export async function unsubscribeNewsletter(
  supabase: SupabaseClient,
  unsubscribeToken: string
): Promise<SubscriberActionResult> {
  const table = newsletterTable(supabase)
  const { data: existingSubscriber, error: lookupError } = await table
    .select('*')
    .eq('unsubscribe_token', unsubscribeToken)
    .maybeSingle()

  if (lookupError || existingSubscriber === null) {
    return { success: false, error: 'Token not found' }
  }

  const { data, error } = await table
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('unsubscribe_token', unsubscribeToken)
    .select()
    .single()

  if (error || data === null) {
    return { success: false, error: error?.message ?? 'Unable to unsubscribe subscriber' }
  }

  return { success: true, subscriber: data }
}

export async function getNewsletterPreferenceByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<NewsletterPreference> {
  const normalizedEmail = normalizeEmail(email)
  if (!validateEmail(normalizedEmail)) {
    return { status: 'off', subscriber: null }
  }

  const { data, error } = await newsletterTable(supabase)
    .select('*')
    .eq('email', normalizedEmail)
    .maybeSingle()

  assertNoError(error)

  if (!data || data.unsubscribed_at) {
    return { status: 'off', subscriber: data }
  }

  return {
    status: data.confirmed_at ? 'on' : 'pending',
    subscriber: data,
  }
}

export async function unsubscribeNewsletterByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!validateEmail(normalizedEmail)) {
    throw new Error('Invalid email')
  }

  const { error } = await newsletterTable(supabase)
    .update({
      unsubscribed_at: new Date().toISOString(),
      confirm_token: newToken(),
      unsubscribe_token: newToken(),
    })
    .eq('email', normalizedEmail)

  assertNoError(error)
}

export async function getSubscribers(
  supabase: SupabaseClient,
  { page = 1, limit = 50 }: GetSubscribersOptions = {}
): Promise<NewsletterSubscriber[]> {
  const currentPage = Math.max(1, page)
  const pageLimit = Math.max(1, limit)
  const from = (currentPage - 1) * pageLimit
  const to = from + pageLimit - 1
  const { data, error } = await newsletterTable(supabase)
    .select('*')
    .order('subscribed_at', { ascending: false })
    .range(from, to)

  assertNoError(error)

  return data ?? []
}

export async function getSubscriberStats(supabase: SupabaseClient): Promise<SubscriberStats> {
  const table = newsletterTable(supabase)
  const [{ count: total, error: totalError }, { count: active, error: activeError }, {
    count: pending,
    error: pendingError,
  }, {
    count: unsubscribed,
    error: unsubscribedError,
  }] = await Promise.all([
    table.select('id', { count: 'exact', head: true }),
    table.select('id', { count: 'exact', head: true }).not('confirmed_at', 'is', null).is('unsubscribed_at', null),
    table.select('id', { count: 'exact', head: true }).is('confirmed_at', null).is('unsubscribed_at', null),
    table.select('id', { count: 'exact', head: true }).not('unsubscribed_at', 'is', null),
  ])

  assertNoError(totalError)
  assertNoError(activeError)
  assertNoError(pendingError)
  assertNoError(unsubscribedError)

  const normalized = {
    total: total ?? 0,
    active: active ?? 0,
    pending: pending ?? 0,
    unsubscribed: unsubscribed ?? 0,
  }
  return {
    ...normalized,
    confirmationRate: calculateConfirmationRate(normalized),
  }
}

export async function getAdminNewsletterSubscribers(
  supabase: SupabaseClient,
  filters: AdminNewsletterFilters = {},
): Promise<AdminNewsletterPage> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100)
  const cursor = filters.cursor ? decodeNewsletterCursor(filters.cursor) : null
  const direction = filters.direction === 'previous' ? 'previous' : 'next'
  const { data, error } = await supabase.rpc('admin_list_newsletter_subscribers', {
    p_query: normalizeAdminQuery(filters.q),
    p_status: filters.status ?? null,
    p_interest: filters.interest ?? null,
    p_cursor_at: cursor?.subscribedAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_direction: direction,
    p_limit: limit + 1,
  })
  assertNoError(error)

  const rows = (data ?? []).map((row: Database['public']['Functions']['admin_list_newsletter_subscribers']['Returns'][number]) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    interests: row.interests,
    locale: row.locale,
    subscribed_at: row.subscribed_at,
    confirmed_at: row.confirmed_at,
    unsubscribed_at: row.unsubscribed_at,
    consent_source: row.consent_source,
    consent_version: row.consent_version,
    consent_recorded_at: row.consent_recorded_at,
    status: parseNewsletterStatus(row.subscriber_status),
  }))
  const hasMore = rows.length > limit
  const visible = rows.slice(0, limit)
  if (direction === 'previous') visible.reverse()

  return {
    subscribers: visible,
    previousCursor:
      cursor && visible[0] ? encodeNewsletterCursor(visible[0]) : null,
    nextCursor:
      (hasMore || direction === 'previous') && visible.at(-1)
        ? encodeNewsletterCursor(visible.at(-1)!)
        : null,
  }
}

export async function getAdminNewsletterExport(
  supabase: SupabaseClient,
  filters: Pick<AdminNewsletterFilters, 'q' | 'status' | 'interest'>,
): Promise<AdminNewsletterSubscriber[]> {
  const { data, error } = await supabase.rpc('admin_export_newsletter_subscribers', {
    p_query: normalizeAdminQuery(filters.q),
    p_status: filters.status ?? null,
    p_interest: filters.interest ?? null,
  })
  assertNoError(error)
  if (!Array.isArray(data)) return []
  return data.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.email !== 'string' || typeof row.subscribed_at !== 'string') return []
    return [{
      id: row.id,
      email: row.email,
      name: typeof row.name === 'string' ? row.name : null,
      interests: Array.isArray(row.interests) ? row.interests.filter((item): item is string => typeof item === 'string') : [],
      locale: typeof row.locale === 'string' ? row.locale : 'zh-TW',
      subscribed_at: row.subscribed_at,
      confirmed_at: typeof row.confirmed_at === 'string' ? row.confirmed_at : null,
      unsubscribed_at: typeof row.unsubscribed_at === 'string' ? row.unsubscribed_at : null,
      consent_source: typeof row.consent_source === 'string' ? row.consent_source : null,
      consent_version: typeof row.consent_version === 'string' ? row.consent_version : null,
      consent_recorded_at: typeof row.consent_recorded_at === 'string' ? row.consent_recorded_at : null,
      status: parseNewsletterStatus(row.subscriber_status),
    }]
  })
}

export async function resendNewsletterConfirmation(
  supabase: SupabaseClient,
  subscriberId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('newsletter_subscribers')
    .select('email, interests, locale, confirmed_at, unsubscribed_at, confirm_token, unsubscribe_token')
    .eq('id', subscriberId)
    .single()
  assertNoError(error)
  if (!data || data.confirmed_at || data.unsubscribed_at) {
    throw new Error('Only pending subscribers can receive a confirmation reminder')
  }

  const delivery = await sendEmail(await buildNewsletterConfirmEmail({
    to: data.email,
    confirmToken: data.confirm_token,
    unsubscribeToken: data.unsubscribe_token,
    interests: data.interests ?? ['curated-picks'],
    locale: data.locale,
  }))
  if (!delivery.success) throw new Error(delivery.error ?? 'Confirmation email could not be sent')
}

export async function adminUnsubscribeNewsletterSubscriber(
  supabase: SupabaseClient,
  subscriberId: string,
): Promise<void> {
  const { data: current, error: lookupError } = await supabase
    .from('newsletter_subscribers')
    .select('id, unsubscribed_at')
    .eq('id', subscriberId)
    .single()
  assertNoError(lookupError)
  if (!current || current.unsubscribed_at) {
    throw new Error('Subscriber is already unsubscribed or no longer exists')
  }

  const { data, error } = await supabase
    .from('newsletter_subscribers')
    .update({
      unsubscribed_at: new Date().toISOString(),
      confirm_token: newToken(),
      unsubscribe_token: newToken(),
    })
    .eq('id', subscriberId)
    .is('unsubscribed_at', null)
    .select('id')
  assertNoError(error)
  if (!data?.length) throw new Error('Subscriber is already unsubscribed')
}

export function parseAdminNewsletterFilters(input: {
  q?: string
  status?: string
  interest?: string
  cursor?: string
  direction?: string
}): AdminNewsletterFilters {
  return {
    q: normalizeAdminQuery(input.q) ?? undefined,
    status: ['active', 'pending', 'unsubscribed'].includes(input.status ?? '')
      ? input.status as NewsletterSubscriberStatus
      : undefined,
    interest: (VALID_INTERESTS as readonly string[]).includes(input.interest ?? '')
      ? input.interest as NewsletterInterest
      : undefined,
    cursor: input.cursor || undefined,
    direction: input.direction === 'previous' ? 'previous' : 'next',
  }
}

function normalizeAdminQuery(value: string | undefined): string | null {
  const normalized = value?.trim().slice(0, 200) ?? ''
  return normalized || null
}

function parseNewsletterStatus(value: unknown): NewsletterSubscriberStatus {
  if (value === 'active' || value === 'unsubscribed') return value
  return 'pending'
}

function encodeNewsletterCursor(subscriber: Pick<AdminNewsletterSubscriber, 'subscribed_at' | 'id'>): string {
  return Buffer.from(JSON.stringify({ subscribedAt: subscriber.subscribed_at, id: subscriber.id })).toString('base64url')
}

function decodeNewsletterCursor(value: string): { subscribedAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (
      typeof parsed.subscribedAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.subscribedAt)) ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(parsed.id)
    ) throw new Error('invalid')
    return { subscribedAt: parsed.subscribedAt, id: parsed.id }
  } catch {
    throw new Error('Invalid newsletter cursor')
  }
}
