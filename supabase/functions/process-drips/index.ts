import { corsHeaders } from '../_shared/cors.ts'
import { verifyCronAuth } from '../_shared/auth.ts'

type DripType = {
  key: string
  description: string
}

type OwnerRow = {
  user_id: string
  email: string
  brand_name: string
  brand_slug: string
  unsubscribe_token: string
}

type EmailMessage = {
  subject: string
  html: string
}

type DenoGlobal = {
  env: {
    get(key: string): string | undefined
  }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

declare const Deno: DenoGlobal | undefined

const FROM_ADDRESS = 'Formoria <noreply@formoria.com>'
const SITE_URL = getEnv('SITE_URL') ?? 'https://formoria.com'
const MICROSITE_HOST = getEnv('MICROSITE_HOST') ?? 'brand.formoria.com'

export const DRIP_TYPES: DripType[] = [
  { key: 'welcome', description: 'Newly claimed owners within last 24h' },
  { key: 'profile_nudge', description: 'Owners with incomplete profile >3 days after claim' },
  { key: 'microsite_spotlight', description: 'Owners with microsite enabled, not yet notified' },
  { key: 're_engagement', description: 'Owners with incomplete profile >14 days after claim' },
]

function getEnv(key: string): string | undefined {
  return globalThis.Deno?.env.get(key)
}

function daysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function unsubscribeUrl(token: string): string {
  return `${SITE_URL}/api/email/unsubscribe?token=${encodeURIComponent(token)}`
}

function unsubscribeFooter(token: string): string {
  const url = unsubscribeUrl(token)
  return `
    <p style="color:#888;font-size:12px;margin-top:32px;">
      如不希望收到此類郵件，請<a href="${url}">點此取消訂閱</a>。<br>
      To unsubscribe from lifecycle emails, <a href="${url}">click here</a>.
    </p>
  `.trim()
}

function buildDripEmail(dripType: string, owner: OwnerRow): EmailMessage {
  const brandName = escapeHtml(owner.brand_name)
  const brandSlug = escapeHtml(owner.brand_slug)
  const dashboardUrl = `${SITE_URL}/dashboard?tab=${brandSlug}`
  const micrositeUrl = `https://${MICROSITE_HOST}/${brandSlug}`
  const footer = unsubscribeFooter(owner.unsubscribe_token)

  if (dripType === 'profile_nudge') {
    return {
      subject: `完善 ${brandName} 的品牌資料 — Formoria`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>讓 ${brandName} 的品牌頁更完整</h2>
          <p>目前品牌資料尚未完整。請回到後台補齊品牌介紹、Logo、社群連結與創立年份。</p>
          <p>Your ${brandName} profile is still incomplete. Add your story, logo, social links, and founding year so buyers understand your brand faster.</p>
          <p><a href="${dashboardUrl}" style="color: #2563eb;">回到品牌後台 / Open dashboard</a></p>
        </div>
        ${footer}
      `.trim(),
    }
  }

  if (dripType === 'microsite_spotlight') {
    return {
      subject: `${brandName} 的品牌官網已就緒 — Formoria`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>${brandName} 的品牌官網</h2>
          <p>您可以分享這個 Formoria 品牌官網，讓買家更快認識您的品牌：</p>
          <p>Your Formoria microsite for ${brandName} is ready to share with buyers.</p>
          <p><a href="${micrositeUrl}" style="color: #2563eb;">${micrositeUrl}</a></p>
        </div>
        ${footer}
      `.trim(),
    }
  }

  if (dripType === 're_engagement') {
    return {
      subject: `回來完善 ${brandName} 的品牌頁 — Formoria`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>繼續完善 ${brandName}</h2>
          <p>完成品牌資料後，買家能更清楚了解您的產品與故事。</p>
          <p>Come back to finish ${brandName}'s profile so buyers can understand your products and story.</p>
          <p><a href="${dashboardUrl}" style="color: #2563eb;">回到品牌後台 / Open dashboard</a></p>
        </div>
        ${footer}
      `.trim(),
    }
  }

  return {
    subject: `歡迎加入 Formoria — ${brandName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>歡迎，${brandName}</h2>
        <p>您的品牌工作區已準備好。您可以前往後台管理品牌資料：</p>
        <p>Welcome to Formoria. Your workspace for ${brandName} is ready.</p>
        <p><a href="${SITE_URL}/dashboard" style="color: #2563eb;">${SITE_URL}/dashboard</a></p>
        <p>品牌微官網連結 / Microsite:</p>
        <p><a href="${micrositeUrl}" style="color: #2563eb;">${micrositeUrl}</a></p>
      </div>
      ${footer}
    `.trim(),
  }
}

function cutoffForDrip(dripType: string): string {
  if (dripType === 'profile_nudge') {
    return daysAgo(3)
  }
  if (dripType === 're_engagement') {
    return daysAgo(14)
  }
  return daysAgo(1)
}

async function sendDripEmail(owner: OwnerRow, message: EmailMessage): Promise<void> {
  const apiKey = getEnv('RESEND_API_KEY') ?? ''

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: owner.email,
      subject: message.subject,
      html: message.html,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Resend API error ${response.status}: ${text}`)
  }
}

type SupabaseLike = {
  from: (table: string) => Record<string, unknown>
  rpc: (fn: string, args?: Record<string, unknown>) => unknown
}

export async function evaluateDrips(
  supabase: SupabaseLike,
  dripType: string
): Promise<{ sent: number; errors: number }> {
  const drip = DRIP_TYPES.find((type) => type.key === dripType)
  if (!drip) {
    throw new Error(`Unknown drip type: ${dripType}`)
  }

  let ownerQuery = supabase
    .from('brand_owners')
    .select(`
      user_id,
      claimed_at,
      brands!inner(name, slug, site_content),
      owner_email_preferences!inner(unsubscribe_token),
      email:users!brand_owners_user_id_fkey(email)
    `)
    .lt('claimed_at', cutoffForDrip(dripType))

  if (dripType === 'microsite_spotlight') {
    ownerQuery = ownerQuery.eq('brands.site_content->>enabled', 'true')
  }

  const { data, error } = await ownerQuery

  if (error) {
    console.error('Failed to query drip owners', { dripType, error })
    return { sent: 0, errors: 1 }
  }

  const { data: sentRows, error: sentError } = await supabase
    .from('email_sends')
    .select('user_id')
    .eq('template_key', dripType)

  if (sentError) {
    console.error('Failed to query prior email sends', { dripType, error: sentError })
    return { sent: 0, errors: 1 }
  }

  const { data: unsubscribedRows, error: preferencesError } = await supabase
    .from('owner_email_preferences')
    .select('user_id')
    .not('unsubscribed_at', 'is', null)

  if (preferencesError) {
    console.error('Failed to query owner email preferences', { dripType, error: preferencesError })
    return { sent: 0, errors: 1 }
  }

  const alreadySentUserIds = new Set((sentRows ?? []).map((row) => row.user_id))
  const unsubscribedUserIds = new Set((unsubscribedRows ?? []).map((row) => row.user_id))
  const owners = (data ?? []).filter((row) => {
    const userId = row.user_id
    return !alreadySentUserIds.has(userId) && !unsubscribedUserIds.has(userId)
  })

  let sent = 0
  let errors = 0

  for (const row of owners) {
    try {
      const owner = normalizeOwnerRow(row)
      const message = buildDripEmail(dripType, owner)
      await sendDripEmail(owner, message)
      const { error: insertError } = await supabase.from('email_sends').insert({
        user_id: owner.user_id,
        template_key: dripType,
      })

      if (insertError) {
        throw new Error(insertError.message ?? 'Failed to record email send')
      }

      sent++
    } catch {
      errors++
    }
  }

  return { sent, errors }
}

function normalizeOwnerRow(row: Record<string, unknown>): OwnerRow {
  const brand = objectValue(Array.isArray(row.brands) ? row.brands[0] : row.brands)
  const preferences = Array.isArray(row.owner_email_preferences)
    ? row.owner_email_preferences[0]
    : row.owner_email_preferences
  const preference = objectValue(preferences)
  const user = objectValue(Array.isArray(row.email) ? row.email[0] : row.email)
  const email = typeof row.email === 'string' ? row.email : stringValue(user?.email)

  return {
    user_id: stringValue(row.user_id),
    email,
    brand_name: stringValue(row.brand_name ?? brand?.name),
    brand_slug: stringValue(row.brand_slug ?? brand?.slug),
    unsubscribe_token: stringValue(row.unsubscribe_token ?? preference?.unsubscribe_token),
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function createSupabaseClient() {
  const supabaseUrl = getEnv('SUPABASE_URL')
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const { createClient } = await import(/* @vite-ignore */ 'https://esm.sh/@supabase/supabase-js@2')
  return createClient(supabaseUrl, serviceRoleKey)
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!verifyCronAuth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabase = await createSupabaseClient()
    const summary: Record<string, { sent: number; errors: number }> = {}
    let sent = 0
    let errors = 0

    for (const drip of DRIP_TYPES) {
      const result = await evaluateDrips(supabase, drip.key)
      summary[drip.key] = result
      sent += result.sent
      errors += result.errors
    }

    return new Response(JSON.stringify({ sent, errors, summary }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}

globalThis.Deno?.serve(handler)
