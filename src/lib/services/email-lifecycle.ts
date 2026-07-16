type EmailLifecycleError = {
  code?: string
  message?: string
}

type EmailPreferencesRow = {
  user_id: string
  unsubscribe_token?: string
  lifecycle_opted_in_at?: string | null
  consent_source?: string | null
  consent_version?: string | null
  unsubscribed_at: string | null
}

type EmailSendRow = {
  id: string
}

type EmailLifecycleResult<T> = Promise<{
  data: T | null
  error: EmailLifecycleError | null
}>

type EqBuilder<T> = {
  eq(column: string, value: string): EqBuilder<T>
  single(): EmailLifecycleResult<T>
  maybeSingle(): EmailLifecycleResult<T>
}

type EmailLifecycleTable = {
  insert(values: Record<string, unknown>): {
    select(columns?: string): {
      single(): EmailLifecycleResult<EmailPreferencesRow | EmailSendRow>
    }
  }
  upsert(values: Record<string, unknown>, options?: { onConflict?: string }): {
    select(columns?: string): {
      single(): EmailLifecycleResult<EmailPreferencesRow>
    }
  }
  select(columns: string): EqBuilder<EmailPreferencesRow | EmailSendRow>
  update(values: Record<string, unknown>): {
    eq(column: string, value: string): EmailLifecycleResult<unknown>
  }
}

function emailLifecycleTable(client: unknown, table: string): EmailLifecycleTable {
  return (client as { from: (table: string) => EmailLifecycleTable }).from(table)
}

export async function createEmailPreferences(supabase: unknown, userId: string) {
  return emailLifecycleTable(supabase, 'owner_email_preferences')
    .upsert({ user_id: userId }, { onConflict: 'user_id' })
    .select()
    .single()
}

export type LifecycleEmailPreference = {
  isOptedIn: boolean
  consentSource: string | null
  consentVersion: string | null
  optedInAt: string | null
  unsubscribedAt: string | null
}

export type SetLifecycleEmailPreferenceInput = {
  userId: string
  enabled: boolean
  consentSource: string
  consentVersion: string
}

export async function setLifecycleEmailPreference(
  supabase: unknown,
  input: SetLifecycleEmailPreferenceInput,
): Promise<void> {
  const now = new Date().toISOString()
  const values: Record<string, unknown> = {
    user_id: input.userId,
    lifecycle_opted_in_at: input.enabled ? now : null,
    unsubscribed_at: input.enabled ? null : now,
    unsubscribe_token: crypto.randomUUID(),
  }

  if (input.enabled) {
    values.consent_source = input.consentSource
    values.consent_version = input.consentVersion
  }

  const { error } = await emailLifecycleTable(
    supabase,
    'owner_email_preferences',
  )
    .upsert(values, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) {
    throw new Error(error.message ?? 'Unable to update lifecycle email preference')
  }
}

export async function getLifecycleEmailPreference(
  supabase: unknown,
  userId: string,
): Promise<LifecycleEmailPreference> {
  const { data, error } = await emailLifecycleTable(
    supabase,
    'owner_email_preferences',
  )
    .select(
      'lifecycle_opted_in_at, consent_source, consent_version, unsubscribed_at',
    )
    .eq('user_id', userId)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') {
    throw new Error(error.message ?? 'Unable to load lifecycle email preference')
  }

  const row = data && 'user_id' in data
    ? data
    : data as EmailPreferencesRow | null
  const optedInAt = row?.lifecycle_opted_in_at ?? null
  const unsubscribedAt = row?.unsubscribed_at ?? null

  return {
    isOptedIn: optedInAt !== null && unsubscribedAt === null,
    consentSource: row?.consent_source ?? null,
    consentVersion: row?.consent_version ?? null,
    optedInAt,
    unsubscribedAt,
  }
}

export async function isLifecycleOptedIn(
  supabase: unknown,
  userId: string,
): Promise<boolean> {
  return (await getLifecycleEmailPreference(supabase, userId)).isOptedIn
}

export async function unsubscribeByToken(
  supabase: unknown,
  token: string
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await emailLifecycleTable(supabase, 'owner_email_preferences')
    .select('*')
    .eq('unsubscribe_token', token)
    .single()

  if (error?.code === 'PGRST116' || data === null) {
    return { success: false, error: 'Token not found' }
  }

  if ('unsubscribed_at' in data && data.unsubscribed_at !== null) {
    return { success: true }
  }

  const { error: updateError } = await emailLifecycleTable(
    supabase,
    'owner_email_preferences',
  )
    .update({
      lifecycle_opted_in_at: null,
      unsubscribed_at: new Date().toISOString(),
    })
    .eq('unsubscribe_token', token)

  if (updateError) {
    return { success: false, error: updateError.message ?? 'Unable to unsubscribe' }
  }

  return { success: true }
}

export async function recordEmailSend(
  supabase: unknown,
  userId: string,
  templateKey: string
): Promise<void> {
  await emailLifecycleTable(supabase, 'email_sends').insert({
    user_id: userId,
    template_key: templateKey,
  })
}

export async function hasSent(
  supabase: unknown,
  userId: string,
  templateKey: string
): Promise<boolean> {
  const { data } = await emailLifecycleTable(supabase, 'email_sends')
    .select('id')
    .eq('user_id', userId)
    .eq('template_key', templateKey)
    .maybeSingle()

  return data !== null
}

export async function isUnsubscribed(supabase: unknown, userId: string): Promise<boolean> {
  const { data, error } = await emailLifecycleTable(supabase, 'owner_email_preferences')
    .select('unsubscribed_at')
    .eq('user_id', userId)
    .single()

  if (error?.code === 'PGRST116' || data === null) {
    return false
  }

  return 'unsubscribed_at' in data && data.unsubscribed_at !== null
}
