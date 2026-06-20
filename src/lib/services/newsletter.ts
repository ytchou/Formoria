import type { SupabaseClient } from '@supabase/supabase-js'

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
  created_at: string
}

type NewsletterSubscriberInsert = {
  email: string
  name?: string | null
  interests: NewsletterInterest[]
  locale?: string
  confirmed_at: null
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
  interests: string[]
  locale?: string
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
  confirmed: number
  unsubscribed: number
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

export async function createSubscriber(
  supabase: SupabaseClient,
  { email, name, interests, locale }: CreateSubscriberInput
): Promise<CreateSubscriberResult> {
  const normalizedEmail = normalizeEmail(email)

  if (!validateEmail(normalizedEmail)) {
    throw new Error('Invalid email')
  }

  const normalizedInterests = normalizeInterests(interests)
  const table = newsletterTable(supabase)
  const { data: existingSubscriber, error: lookupError } = await table
    .select('*')
    .eq('email', normalizedEmail)
    .maybeSingle()

  assertNoError(lookupError)

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
      return {
        subscriber: existingSubscriber,
        isNew: false,
        needsConfirmation: false,
      }
    }

    const { data, error } = await table
      .update({
        name: name ?? existingSubscriber.name,
        interests: normalizedInterests,
        confirm_token: newToken(),
        unsubscribe_token: newToken(),
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

  const { data, error } = await table
    .update({
      confirmed_at: new Date().toISOString(),
      confirm_token: newToken(),
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
  const [{ count: total, error: totalError }, { count: confirmed, error: confirmedError }, {
    count: unsubscribed,
    error: unsubscribedError,
  }] = await Promise.all([
    table.select('id', { count: 'exact', head: true }),
    table.select('id', { count: 'exact', head: true }).not('confirmed_at', 'is', null),
    table.select('id', { count: 'exact', head: true }).not('unsubscribed_at', 'is', null),
  ])

  assertNoError(totalError)
  assertNoError(confirmedError)
  assertNoError(unsubscribedError)

  return {
    total: total ?? 0,
    confirmed: confirmed ?? 0,
    unsubscribed: unsubscribed ?? 0,
  }
}
