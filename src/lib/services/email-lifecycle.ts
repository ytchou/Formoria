import { auditedCall } from '@/lib/audit'

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
  upsert(values: Record<string, unknown>, options?: { onConflict?: string }): {
    select(columns?: string): {
      single(): EmailLifecycleResult<EmailPreferencesRow>
    }
  }
  select(columns: string): EqBuilder<EmailPreferencesRow>
  update(values: Record<string, unknown>): {
    eq(column: string, value: string): EmailLifecycleResult<unknown>
  }
}

function emailLifecycleTable(client: unknown, table: string): EmailLifecycleTable {
  return (client as { from: (table: string) => EmailLifecycleTable }).from(table)
}

export async function createEmailPreferences(supabase: unknown, userId: string) {
  return auditedCall(
    { provider: 'email', operation: 'createEmailPreferences', kind: 'service' },
    () => emailLifecycleTable(supabase, 'owner_email_preferences')
      .upsert({ user_id: userId }, { onConflict: 'user_id' })
      .select()
      .single(),
  )
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
  return auditedCall(
    { provider: 'email', operation: 'setLifecycleEmailPreference', kind: 'service' },
    async () => {
  const now = new Date().toISOString()

  const { data: existing } = await emailLifecycleTable(
    supabase,
    'owner_email_preferences',
  )
    .select('unsubscribe_token')
    .eq('user_id', input.userId)
    .maybeSingle()

  const existingRow = existing as EmailPreferencesRow | null

  const values: Record<string, unknown> = {
    user_id: input.userId,
    lifecycle_opted_in_at: input.enabled ? now : null,
    unsubscribed_at: input.enabled ? null : now,
  }

  // Only mint a token for new rows — preserves unsubscribe links in delivered emails
  if (!existingRow?.unsubscribe_token) {
    values.unsubscribe_token = crypto.randomUUID()
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
    },
  )
}

export async function unsubscribeByToken(
  supabase: unknown,
  token: string
): Promise<{ success: boolean; error?: string }> {
  return auditedCall(
    { provider: 'email', operation: 'unsubscribeByToken', kind: 'service' },
    async () => {
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
    },
  )
}
