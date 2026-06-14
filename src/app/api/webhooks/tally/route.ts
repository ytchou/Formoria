import crypto from 'crypto'
import { createFeedbackFromTally } from '@/lib/services/feedback'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const secret = process.env.TALLY_WEBHOOK_SIGNING_SECRET
    if (!secret) {
      console.error('[webhook:tally] TALLY_WEBHOOK_SIGNING_SECRET not set')
      return new Response(null, { status: 500 })
    }

    const rawBody = await request.text()
    const signature = request.headers.get('tally-signature')

    if (!signature) {
      return new Response(null, { status: 401 })
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

    let sigBuffer: Buffer
    let expBuffer: Buffer
    try {
      sigBuffer = Buffer.from(signature)
      expBuffer = Buffer.from(expected)
    } catch {
      return new Response(null, { status: 401 })
    }

    if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(expBuffer, sigBuffer)) {
      return new Response(null, { status: 401 })
    }

    let payload: {
      data: {
        responseId: string
        fields: Array<{ label: string; type: string; value: unknown }>
        pageContext?: { url?: string }
      }
    }
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return new Response(null, { status: 400 })
    }

    const { data } = payload
    const fields = data.fields ?? []

    const typeField = fields.find((f) => f.label === '回饋類型')
    const messageField = fields.find((f) => f.label === '詳細說明')
    const titleField = fields.find((f) => f.label === '標題')
    const emailField = fields.find((f) => f.label === '電子信箱')

    const type = typeField?.value === 'bug' ? 'bug' : 'feedback'
    const body = typeof messageField?.value === 'string' ? messageField.value : undefined
    const title = typeof titleField?.value === 'string' ? titleField.value : undefined
    const url = data.pageContext?.url ?? undefined
    const userEmail = typeof emailField?.value === 'string' ? emailField.value : undefined

    await createFeedbackFromTally({
      tallyResponseId: data.responseId,
      type,
      title,
      body,
      url,
      userEmail,
    })

    return new Response(null, { status: 200 })
  } catch (err) {
    console.error('[webhook:tally]', err)
    return new Response(null, { status: 500 })
  }
}
