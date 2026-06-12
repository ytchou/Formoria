type EmailLifecycleError = {
  code?: string
  message?: string
}

type EmailPreferencesRow = {
  user_id: string
  unsubscribe_token?: string
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
    .insert({ user_id: userId })
    .select()
    .single()
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
    return { success: false, error: 'Already unsubscribed' }
  }

  await emailLifecycleTable(supabase, 'owner_email_preferences')
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('unsubscribe_token', token)

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
